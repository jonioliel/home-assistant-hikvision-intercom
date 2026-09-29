"""Bounded operations preferences; no credentials, device ownership or network I/O."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import re
import secrets
import time
from collections.abc import Awaitable, Callable
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .access.models import AccessError
from .whatsapp_templates import render_template

DEFAULT_RETENTION = {"days": 30, "count": 5000, "bytes": 16_777_216}
DEFAULT_THRESHOLDS = {"offline": 600, "sync_stalled": 900, "event_gap": 600}
COLLECTIONS = {"stations", "templates", "views", "reports", "door_presets"}


def canonical(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode()


def text(value: Any, maximum: int, *, empty: bool = False, multiline: bool = False) -> str:
    if not isinstance(value, str) or len(value) > maximum or not empty and not value.strip():
        raise AccessError("invalid_fields")
    if any(ord(c) < 32 and not (multiline and c in "\r\n\t") for c in value):
        raise AccessError("invalid_fields")
    return value.strip()


def integer(value: Any, low: int, high: int) -> int:
    if type(value) is not int or not low <= value <= high:
        raise AccessError("invalid_fields")
    return value


def exact(value: Any, keys: set[str]) -> dict:
    if not isinstance(value, dict) or set(value) != keys:
        raise AccessError("invalid_fields")
    return value


def retention(value: Any) -> dict:
    exact(value, set(DEFAULT_RETENTION))
    return {
        "days": integer(value["days"], 1, 365),
        "count": integer(value["count"], 100, 20000),
        "bytes": integer(value["bytes"], 262144, 25_165_824),
    }


def window(value: Any) -> dict:
    exact(value, {"enabled", "days", "start", "end", "timezone"})
    if type(value["enabled"]) is not bool or not isinstance(value["days"], list):
        raise AccessError("invalid_fields")
    days = [integer(day, 0, 6) for day in value["days"]]
    if len(days) != len(set(days)) or value["enabled"] and not days:
        raise AccessError("invalid_fields")
    for key in ("start", "end"):
        if not isinstance(value[key], str) or not re.fullmatch(
            r"(?:[01]\d|2[0-3]):[0-5]\d", value[key]
        ):
            raise AccessError("invalid_fields")
    if value["start"] >= value["end"]:
        raise AccessError("invalid_fields")
    zone = text(value["timezone"], 100)
    try:
        ZoneInfo(zone)
    except (ZoneInfoNotFoundError, ValueError):
        raise AccessError("invalid_fields") from None
    return {**value, "days": sorted(days), "timezone": zone}


def in_window(value: dict, now: datetime) -> bool:
    if not value["enabled"]:
        return True
    local = now.astimezone(ZoneInfo(value["timezone"]))
    return (
        local.weekday() in value["days"]
        and value["start"] <= local.strftime("%H:%M") < value["end"]
    )


def filters(value: Any) -> dict:
    # These are the existing server report filters, never a query expression.
    allowed = {
        "person",
        "station_id",
        "result",
        "event_type",
        "door",
        "authentication",
        "start",
        "end",
        "current_group",
        "current_profile",
    }
    if not isinstance(value, dict) or set(value) - allowed:
        raise AccessError("invalid_fields")
    result = {}
    for key, item in value.items():
        if key == "current_profile":
            if not isinstance(item, dict) or len(item) > 20:
                raise AccessError("invalid_fields")
            result[key] = {text(k, 100): text(v, 300) for k, v in item.items()}
        elif key == "door":
            result[key] = integer(item, 1, 2)
        else:
            result[key] = text(item, 300, empty=True)
    from .events import EventCache
    from .exceptions import HikvisionValidationError

    try:
        EventCache().query(
            {k: v for k, v in result.items() if k not in {"current_group", "current_profile"}},
            datetime.now(UTC),
        )
    except HikvisionValidationError:
        raise AccessError("invalid_fields") from None
    return result


def record(collection: str, value: Any) -> dict:
    if collection == "door_presets":
        from .client.technical import FIELDS, validate_changes
        from .exceptions import HikvisionValidationError

        exact(value, {"label", "changes"})
        changes = value["changes"]
        # Structural bounds only. Saving a preset does not assert that a station
        # advertises these fields; actual capabilities are read for every review.
        bounds = {
            "doorName": {"type": "text", "min": 1, "max": 64},
            "openDuration": {"type": "integer", "min": 0, "max": 255},
            "relayReverseEnabled": {"type": "boolean"},
        }
        try:
            validate_changes(changes, bounds)
        except HikvisionValidationError:
            raise AccessError("invalid_fields") from None
        return {
            "label": text(value["label"], 120),
            "changes": {key: changes[key] for key in FIELDS if key in changes},
        }
    if collection == "stations":
        exact(value, {"zone", "owner", "tags", "thresholds", "window"})
        if not isinstance(value["tags"], list) or len(value["tags"]) > 16:
            raise AccessError("invalid_fields")
        exact(value["thresholds"], set(DEFAULT_THRESHOLDS))
        return {
            "zone": text(value["zone"], 120, empty=True),
            "owner": text(value["owner"], 120, empty=True),
            "tags": sorted(set(text(tag, 40) for tag in value["tags"])),
            "thresholds": {k: integer(v, 60, 86400) for k, v in value["thresholds"].items()},
            "window": window(value["window"]),
        }
    if collection == "templates":
        exact(value, {"label", "language", "category", "credential", "body"})
        if (
            value["language"] not in {"he", "en"}
            or value["category"] not in {"any", "staff", "visitor", "contractor"}
            or value["credential"] not in {"any", "pin", "card", "none"}
        ):
            raise AccessError("invalid_fields")
        body = text(value["body"], 12000, multiline=True)
        from .whatsapp_templates import PLACEHOLDERS

        tokens = re.findall(r"{{\s*([a-z_]+)\s*}}", body)
        remainder = re.sub(r"{{\s*([a-z_]+)\s*}}", "", body)
        if (
            "{{" in remainder
            or "}}" in remainder
            or set(tokens) - PLACEHOLDERS
            or "name" not in tokens
            or "credential_section" not in tokens
            or "access_window_section" not in tokens
            or "security_notice" not in tokens
        ):
            raise AccessError("template_placeholders_invalid")
        return {**value, "label": text(value["label"], 100), "body": body}
    if collection == "views":
        exact(value, {"label", "filters"})
        return {"label": text(value["label"], 100), "filters": filters(value["filters"])}
    if collection == "reports":
        exact(value, {"label", "filters", "enabled", "hour", "timezone", "days"})
        if type(value["enabled"]) is not bool:
            raise AccessError("invalid_fields")
        checked = window(
            {
                "enabled": value["enabled"],
                "days": value["days"],
                "start": "00:00",
                "end": "23:59",
                "timezone": value["timezone"],
            }
        )
        return {
            **value,
            "label": text(value["label"], 100),
            "filters": filters(value["filters"]),
            "hour": integer(value["hour"], 0, 23),
            "days": checked["days"],
            "timezone": checked["timezone"],
        }
    raise AccessError("invalid_fields")


def webhook_settings(value: Any) -> dict:
    exact(value, {"enabled", "url", "kinds"})
    if (
        type(value["enabled"]) is not bool
        or not isinstance(value["kinds"], list)
        or len(value["kinds"]) > 8
        or any(not isinstance(kind, str) for kind in value["kinds"])
    ):
        raise AccessError("invalid_fields")
    kinds = set(value["kinds"])
    if kinds - {"access_event", "security_denied", "configuration_result"}:
        raise AccessError("invalid_fields")
    url = text(value["url"], 1000, empty=not value["enabled"])
    if url:
        parsed = urlsplit(url)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.fragment
            or parsed.query
        ):
            raise AccessError("webhook_https_required")
        try:
            if parsed.port not in {None, 443, 8443}:
                raise AccessError("webhook_https_required")
        except ValueError:
            raise AccessError("webhook_https_required") from None
    if value["enabled"] and not kinds:
        raise AccessError("invalid_fields")
    return {"enabled": value["enabled"], "url": url, "kinds": sorted(kinds)}


class OperationsCenter:
    """Save-first preference mutations and one-use actor/revision-bound reviews."""

    def __init__(self, save: Callable[[dict], Awaitable[None]]) -> None:
        self._save = save
        self._lock = asyncio.Lock()
        self.data = {
            "schema": 2,
            "revision": 0,
            "retention": deepcopy(DEFAULT_RETENTION),
            "stations": {},
            "templates": {},
            "door_presets": {},
            "views": {},
            "reports": {},
            "journal": [],
            "observations": [],
            "report_runs": [],
            "receipts": [],
            "webhook": {"enabled": False, "url": "", "kinds": []},
            "signing_key": secrets.token_hex(32),
            "webhook_key": secrets.token_hex(32),
        }
        self.reviews: dict[str, dict] = {}

    def load(self, data: Any) -> None:
        if data is None:
            return
        try:
            if isinstance(data, dict) and type(data.get("schema")) is int and data["schema"] == 1:
                exact(data, set(self.data) - {"door_presets"})
                data = {**deepcopy(data), "schema": 2, "door_presets": {}}
            self.validate(data)
        except (AccessError, ValueError, TypeError, KeyError, OverflowError):
            raise AccessError("storage_corrupt") from None
        self.data = deepcopy(data)

    def validate(self, data: dict) -> None:
        exact(data, set(self.data))
        if type(data["schema"]) is not int or data["schema"] != 2:
            raise AccessError("invalid_fields")
        integer(data["revision"], 0, 2**63 - 1)
        retention(data["retention"])
        webhook_settings(data["webhook"])
        for key in ("signing_key", "webhook_key"):
            if not isinstance(data[key], str) or not re.fullmatch("[0-9a-f]{64}", data[key]):
                raise AccessError("invalid_fields")
        for collection in COLLECTIONS:
            rows = data[collection]
            if not isinstance(rows, dict) or len(rows) > 500:
                raise AccessError("invalid_fields")
            for identifier, row in rows.items():
                text(identifier, 128)
                owner = row.get("actor")
                text(owner, 128)
                exact(row, {"actor", "values"})
                record(collection, row["values"])
        schemas = {
            "journal": {"at", "actor", "command", "code"},
            "observations": {"at", "station_id", "source", "state", "rtt_ms"},
            "receipts": {"at", "station_id", "state", "code"},
            "report_runs": {"at", "report_id", "actor", "total", "granted", "denied", "code"},
        }
        for key, fields in schemas.items():
            rows = data[key]
            if not isinstance(rows, list) or len(rows) > 1000:
                raise AccessError("invalid_fields")
            for row in rows:
                exact(row, fields)
                moment = datetime.fromisoformat(row["at"])
                if moment.tzinfo is None:
                    raise AccessError("invalid_fields")
                for field, value in row.items():
                    if field in {"total", "granted", "denied"}:
                        integer(value, 0, 20000)
                    elif field == "rtt_ms":
                        if value is not None:
                            integer(value, 0, 300000)
                    else:
                        text(value, 128, empty=field in {"actor", "code"})
        if len(canonical(data)) > 3_000_000:
            raise AccessError("request_too_large")

    async def mutate(
        self, revision: int | None, apply: Callable[[dict], None], *, invalidate: bool = True
    ) -> None:
        async with self._lock:
            if revision is not None and (
                type(revision) is not int or revision != self.data["revision"]
            ):
                raise AccessError("revision_conflict")
            candidate = deepcopy(self.data)
            apply(candidate)
            if invalidate:
                candidate["revision"] += 1
            self.validate(candidate)
            await self._save(deepcopy(candidate))
            self.data = candidate

    def public(self, actor: str) -> dict:
        data = deepcopy(self.data)
        data.pop("signing_key")
        data.pop("webhook_key")
        # Personal views/reports never cross an account boundary, even between admins.
        for key in ("views", "reports"):
            data[key] = {
                identifier: row for identifier, row in data[key].items() if row["actor"] == actor
            }
        data["report_runs"] = [row for row in data["report_runs"] if row["actor"] == actor]
        return data

    async def save_record(
        self, collection: str, identifier: str, revision: int, values: Any, actor: str
    ) -> dict:
        if collection not in COLLECTIONS:
            raise AccessError("invalid_fields")
        identifier = text(identifier, 128, empty=True) or str(uuid4())
        values = record(collection, values)

        def apply(data):
            previous = data[collection].get(identifier)
            if collection in {"views", "reports"} and previous and previous["actor"] != actor:
                raise AccessError("unauthorized")
            if collection == "templates":
                selection = tuple(values[k] for k in ("language", "category", "credential"))
                if any(
                    key != identifier
                    and tuple(row["values"][k] for k in ("language", "category", "credential"))
                    == selection
                    for key, row in data[collection].items()
                ):
                    raise AccessError("template_selection_duplicate")
            data[collection][identifier] = {"actor": actor, "values": values}

        await self.mutate(revision, apply)
        return {"id": identifier, "revision": self.data["revision"]}

    async def delete_record(
        self, collection: str, identifier: str, revision: int, actor: str
    ) -> dict:
        if collection not in COLLECTIONS:
            raise AccessError("invalid_fields")

        def apply(data):
            row = data[collection].get(identifier)
            if not row or collection in {"views", "reports"} and row["actor"] != actor:
                raise AccessError("record_not_found")
            del data[collection][identifier]

        await self.mutate(revision, apply)
        return {"revision": self.data["revision"]}

    def variant(self, user: Any, language: str) -> dict | None:
        credential = (
            "pin" if user.pin else "card" if any(card.enabled for card in user.cards) else "none"
        )
        category = user.access_category
        choices = []
        for key, row in self.data["templates"].items():
            value = row["values"]
            if (
                value["language"] == language
                and value["category"] in {category, "any"}
                and value["credential"] in {credential, "any"}
            ):
                rank = (value["category"] != "any") * 2 + (value["credential"] != "any")
                choices.append((rank, key, value))
        return deepcopy(max(choices, default=(0, "", None))[2])

    def review(self, actor: str, kind: str, values: dict, stamp: str = "") -> str:
        now = time.monotonic()
        self.reviews = {key: row for key, row in self.reviews.items() if row["expires"] > now}
        if len(self.reviews) >= 100:
            raise AccessError("rate_limited")
        token = secrets.token_urlsafe(32)
        self.reviews[token] = {
            "actor": actor,
            "kind": kind,
            "revision": self.data["revision"],
            "values": deepcopy(values),
            "stamp": stamp,
            "expires": now + 300,
        }
        return token

    def consume(self, actor: str, token: str, kind: str, confirmed: bool, stamp: str = "") -> dict:
        # A wrong actor cannot burn another actor's review.
        row = self.reviews.get(token)
        if not row or row["actor"] != actor:
            raise AccessError("review_expired")
        if confirmed is not True:
            raise AccessError("confirmation_required")
        del self.reviews[token]
        if (
            row["expires"] <= time.monotonic()
            or row["kind"] != kind
            or row["revision"] != self.data["revision"]
            or row["stamp"] != stamp
        ):
            raise AccessError("review_expired")
        return deepcopy(row["values"])

    async def append(self, key: str, row: dict) -> None:
        if key not in {"journal", "observations", "report_runs", "receipts"}:
            raise AccessError("invalid_fields")
        await self.mutate(
            None,
            lambda data: data.__setitem__(key, [*data[key], deepcopy(row)][-500:]),
            invalidate=False,
        )

    def export(self, stations: dict[str, str]) -> dict:
        # Preferences only; exclude users, rights, private keys, destinations and journals.
        return {
            "format": "smplwise-operations",
            "version": 1,
            "stations": {
                key: {"name": stations.get(key, key), "values": deepcopy(row["values"])}
                for key, row in self.data["stations"].items()
                if key in stations
            },
            "templates": [deepcopy(row["values"]) for row in self.data["templates"].values()],
        }

    def import_review(self, actor: str, content: str, mapping: dict, targets: set[str]) -> dict:
        try:
            if not isinstance(content, str) or len(content.encode()) > 60000:
                raise ValueError

            def unique(pairs):
                result = {}
                for key, value in pairs:
                    if key in result:
                        raise ValueError
                    result[key] = value
                return result

            source = json.loads(content, object_pairs_hook=unique)
            exact(source, {"format", "version", "stations", "templates"})
            if (
                source["format"] != "smplwise-operations"
                or type(source["version"]) is not int
                or source["version"] != 1
                or not isinstance(source["stations"], dict)
                or len(source["stations"]) > 500
                or not isinstance(source["templates"], list)
                or len(source["templates"]) > 500
            ):
                raise ValueError
            if (
                not isinstance(mapping, dict)
                or set(mapping) != set(source["stations"])
                or len(set(mapping.values())) != len(mapping)
                or set(mapping.values()) - targets
            ):
                raise AccessError("station_mapping_required")
            stations = {}
            preview = []
            for key, row in source["stations"].items():
                exact(row, {"name", "values"})
                text(key, 128)
                name = text(row["name"], 128)
                stations[mapping[key]] = record("stations", row["values"])
                preview.append(
                    {
                        "source": key,
                        "name": name,
                        "target": mapping[key],
                        "replaces": mapping[key] in self.data["stations"],
                    }
                )
            templates = [record("templates", row) for row in source["templates"]]
            selections = [
                tuple(row[k] for k in ("language", "category", "credential")) for row in templates
            ]
            if len(selections) != len(set(selections)):
                raise AccessError("template_selection_duplicate")
            token = self.review(
                actor,
                "import",
                {"stations": stations, "templates": templates},
                hashlib.sha256(canonical(sorted(targets))).hexdigest(),
            )
            return {
                "review_id": token,
                "stations": preview,
                "templates": len(templates),
                "replaces_templates": True,
            }
        except (ValueError, TypeError, KeyError):
            raise AccessError("configuration_invalid") from None

    async def import_apply(
        self, actor: str, token: str, confirmed: bool, targets: set[str]
    ) -> dict:
        values = self.consume(
            actor,
            token,
            "import",
            confirmed,
            hashlib.sha256(canonical(sorted(targets))).hexdigest(),
        )
        revision = self.data["revision"]

        def apply(data):
            data["stations"].update(
                {key: {"actor": actor, "values": row} for key, row in values["stations"].items()}
            )
            data["templates"] = {
                str(uuid4()): {"actor": actor, "values": row} for row in values["templates"]
            }

        await self.mutate(revision, apply)
        return {"revision": self.data["revision"], "stations": len(values["stations"])}


def message_warnings(user: Any) -> list[str]:
    result = []
    if not user.phone:
        result.append("phone_missing")
    if not user.pin and not any(card.enabled for card in user.cards):
        result.append("credential_missing")
    if not any(row.enabled for row in user.assignments.values()):
        result.append("doors_missing")
    if not user.active:
        result.append("user_inactive")
    return result


def signed_webhook(
    key: str, kind: str, values: dict, *, event_id: str, at: str
) -> tuple[bytes, dict[str, str]]:
    allowed = {
        "access_event": {"station_id", "result", "authentication", "door", "timestamp"},
        "security_denied": {"command", "code"},
        "configuration_result": {"station_id", "state", "code"},
    }
    if kind not in allowed:
        raise AccessError("invalid_fields")
    payload = canonical(
        {
            "version": 1,
            "id": event_id,
            "kind": kind,
            "at": at,
            "values": {k: values[k] for k in sorted(allowed[kind]) if k in values},
        }
    )
    signature = hmac.new(
        bytes.fromhex(key), at.encode() + b"." + payload, hashlib.sha256
    ).hexdigest()
    return payload, {
        "Content-Type": "application/json",
        "X-Smplwise-Timestamp": at,
        "X-Smplwise-Signature": "sha256=" + signature,
        "X-Smplwise-Event-Id": event_id,
    }


def preview_variant(body: str, variables: dict) -> str:
    return render_template(body, variables)
