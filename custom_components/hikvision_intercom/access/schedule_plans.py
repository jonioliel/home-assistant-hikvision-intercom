"""Durable local deployment proposals and reservations, never device ownership or writes."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import secrets
import time
from collections.abc import Callable
from copy import deepcopy
from datetime import datetime
from typing import Any
from uuid import uuid4

from .diagnostics import SAFE_ERRORS
from .models import AccessError, utc_now, uuid_text
from .repository import Save
from .schedule_baselines import valid_hash
from .schedule_compiler import compile_schedule
from .schedules import normalize

MAX_PLANS = 32
BLOCKERS = {
    "schedule_writes_unverified",
    "schedule_ownership_unknown",
    "schedule_inventory_incomplete",
    "schedule_plan_users_unreadable",
    "schedule_plan_user_defaults",
    "schedule_plan_external_references",
    "schedule_plan_capabilities_changed",
    "schedule_plan_active_resources",
    "schedule_plan_observation_incomplete",
    "schedule_plan_holiday_membership_unknown",
}
FIELDS = {
    "enable",
    "templateName",
    "weekPlanNo",
    "holidayGroupNo",
    "groupName",
    "holidayPlanNo",
    "WeekPlanCfg",
    "beginDate",
    "endDate",
    "HolidayPlanCfg",
}


def timestamp(value: Any) -> None:
    if not isinstance(value, str) or datetime.fromisoformat(value).tzinfo is None:
        raise AccessError("invalid_storage")


def validate_report(report: Any, candidates: list[dict[str, Any]]) -> None:
    if (
        not isinstance(report, dict)
        or set(report) != {"checked_at", "can_apply", "blockers", "resources", "users"}
        or report["can_apply"] is not False
    ):
        raise AccessError("invalid_storage")
    timestamp(report["checked_at"])
    blockers = report["blockers"]
    if (
        not isinstance(blockers, list)
        or any(not isinstance(b, str) or b not in BLOCKERS for b in blockers)
        or len(blockers) != len(set(blockers))
        or not {"schedule_writes_unverified", "schedule_ownership_unknown"} <= set(blockers)
    ):
        raise AccessError("invalid_storage")
    rows = report["resources"]
    if not isinstance(rows, list) or len(rows) != len(candidates):
        raise AccessError("invalid_storage")
    for row, candidate in zip(rows, candidates, strict=True):
        if (
            not isinstance(row, dict)
            or set(row)
            != {"kind", "id", "coverage", "state", "fields", "active", "externally_referenced"}
            or row["kind"] != candidate["kind"]
            or type(row["id"]) is not int
            or row["id"] != candidate["id"]
        ):
            raise AccessError("invalid_storage")
        if row["coverage"] not in (
            "complete",
            "partial",
            "failed",
            "unsupported",
            "not_checked",
        ) or row["state"] not in (
            "matches",
            "different",
            "not_observed",
            "unreadable",
            "unsupported",
        ):
            raise AccessError("invalid_storage")
        if any(
            row[k] is not None and type(row[k]) is not bool
            for k in ("active", "externally_referenced")
        ):
            raise AccessError("invalid_storage")
        fields = row["fields"]
        if (
            not isinstance(fields, list)
            or any(not isinstance(f, str) or f not in FIELDS for f in fields)
            or len(fields) != len(set(fields))
        ):
            raise AccessError("invalid_storage")
    users = report["users"]
    if (
        not isinstance(users, dict)
        or set(users) != {"state", "error", "read", "explicit", "implicit", "malformed"}
        or users["state"] not in ("complete", "failed")
    ):
        raise AccessError("invalid_storage")
    if users["error"] is not None and (
        not isinstance(users["error"], str) or users["error"] not in SAFE_ERRORS
    ):
        raise AccessError("invalid_storage")
    if any(
        users[k] is not None and (type(users[k]) is not int or not 0 <= users[k] <= 20000)
        for k in ("read", "explicit", "implicit", "malformed")
    ):
        raise AccessError("invalid_storage")


class SchedulePlans:
    """Isolated private store; approval binds the read result, source revision and device."""

    def __init__(self, save: Save, *, now: Callable[[], float] = time.monotonic) -> None:
        self._save, self._now = save, now
        self._state: dict[str, Any] = {"schema": 1, "key": secrets.token_hex(32), "plans": {}}
        self._pending: dict[str, dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    def fingerprint(self, value: Any) -> str:
        body = json.dumps(
            value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False
        )
        return hmac.new(
            bytes.fromhex(self._state["key"]), body.encode(), hashlib.sha256
        ).hexdigest()

    def _validate(self, item: Any) -> None:
        if not isinstance(item, dict) or set(item) != {
            "id",
            "revision",
            "station_id",
            "identity",
            "draft_id",
            "draft_revision",
            "draft",
            "bindings",
            "capabilities",
            "capability_fingerprint",
            "fingerprints",
            "drifted_resources",
            "created_at",
            "report",
        }:
            raise AccessError("invalid_storage")
        uuid_text(item["id"])
        uuid_text(item["draft_id"])
        if (
            any(
                type(item[k]) is not int or not 1 <= item[k] <= 2147483647
                for k in ("revision", "draft_revision")
            )
            or not valid_hash(item["identity"])
            or not isinstance(item["station_id"], str)
            or not 1 <= len(item["station_id"]) <= 64
        ):
            raise AccessError("invalid_storage")
        if not valid_hash(item["capability_fingerprint"]):
            raise AccessError("invalid_storage")
        timestamp(item["created_at"])
        normalize(item["draft"])
        candidates = compile_schedule(item["draft"], item["bindings"], item["capabilities"])
        validate_report(item["report"], candidates)
        hashes = item["fingerprints"]
        keys = {r["key"] for r in candidates}
        if (
            not isinstance(hashes, dict)
            or set(hashes) != keys
            or any(v is not None and not valid_hash(v) for v in hashes.values())
        ):
            raise AccessError("invalid_storage")
        changed = item["drifted_resources"]
        if (
            not isinstance(changed, list)
            or any(not isinstance(k, str) or k not in keys for k in changed)
            or len(changed) != len(set(changed))
        ):
            raise AccessError("invalid_storage")

    async def async_load(self, data: Any) -> None:
        async with self._lock:
            if data is None:
                await self._save(deepcopy(self._state))
                return
            try:
                if (
                    not isinstance(data, dict)
                    or set(data) != {"schema", "key", "plans"}
                    or type(data["schema"]) is not int
                    or data["schema"] != 1
                    or not valid_hash(data["key"])
                    or not isinstance(data["plans"], dict)
                    or len(data["plans"]) > MAX_PLANS
                ):
                    raise AccessError("invalid_storage")
                for key, item in data["plans"].items():
                    self._validate(item)
                    if key != item["id"]:
                        raise AccessError("invalid_storage")
                reserved: dict[str, set[str]] = {}
                for item in data["plans"].values():
                    used = reserved.setdefault(item["station_id"], set())
                    if used & item["fingerprints"].keys():
                        raise AccessError("invalid_storage")
                    used.update(item["fingerprints"])
                self._state = deepcopy(data)
            except (AccessError, ValueError, TypeError, KeyError, AttributeError):
                raise AccessError("invalid_storage") from None
            self._pending.clear()

    def get(self, identifier: str, revision: int | None = None) -> dict[str, Any]:
        item = self._state["plans"].get(identifier)
        if not item:
            raise AccessError("schedule_plan_not_found")
        if revision is not None and (type(revision) is not int or item["revision"] != revision):
            raise AccessError("revision_conflict")
        return deepcopy(item)

    def public(self, item: dict[str, Any], *, details: bool = False) -> dict[str, Any]:
        result = {
            k: deepcopy(item[k])
            for k in (
                "id",
                "revision",
                "station_id",
                "draft_id",
                "draft_revision",
                "bindings",
                "drifted_resources",
                "created_at",
                "report",
            )
        }
        result.update(name=item["draft"]["name"], can_apply=False)
        if details:
            result["candidates"] = compile_schedule(
                item["draft"], item["bindings"], item["capabilities"]
            )
        return result

    def all(self) -> list[dict[str, Any]]:
        return [self.public(item) for item in self._state["plans"].values()]

    def _reserve(self, item: dict[str, Any], *, exclude: str = "") -> None:
        keys = item["fingerprints"].keys()
        for key, other in self._state["plans"].items():
            if (
                key != exclude
                and other["station_id"] == item["station_id"]
                and keys & other["fingerprints"].keys()
            ):
                raise AccessError("schedule_plan_resource_reserved")

    def preview(
        self,
        station: str,
        identity: str,
        draft_id: str,
        revision: int,
        draft: Any,
        bindings: Any,
        inspection: dict[str, Any],
        actor: str,
    ) -> dict[str, Any]:
        item = {
            "id": str(uuid4()),
            "revision": 1,
            "station_id": station,
            "identity": identity,
            "draft_id": draft_id,
            "draft_revision": revision,
            "draft": normalize(draft),
            "bindings": deepcopy(bindings),
            "capabilities": deepcopy(inspection["capabilities"]),
            "capability_fingerprint": inspection["capability_fingerprint"],
            "fingerprints": deepcopy(inspection["fingerprints"]),
            "drifted_resources": [],
            "created_at": utc_now(),
            "report": deepcopy(inspection["report"]),
        }
        self._validate(item)
        self._reserve(item)
        if len(self._state["plans"]) >= MAX_PLANS:
            raise AccessError("schedule_plan_limit")
        self._pending = {
            k: v
            for k, v in self._pending.items()
            if v["expires"] > self._now() and v["actor"] != actor
        }
        if len(self._pending) >= 16:
            del self._pending[next(iter(self._pending))]
        token = uuid4().hex
        self._pending[token] = {"actor": actor, "expires": self._now() + 300, "item": item}
        return {**self.public(item, details=True), "token": token}

    def pending(self, token: str, actor: str) -> dict[str, Any]:
        value = self._pending.get(token)
        if not value or value["actor"] != actor or value["expires"] <= self._now():
            raise AccessError("schedule_plan_expired")
        return deepcopy(value["item"])

    async def _persist(self, state: dict[str, Any]) -> None:
        async def commit() -> None:
            await self._save(deepcopy(state))
            self._state = state

        task = asyncio.create_task(commit())
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            await task
            raise

    async def async_save(
        self, token: str, actor: str, identity: str, draft_revision: int
    ) -> dict[str, Any]:
        async with self._lock:
            item = self.pending(token, actor)
            if item["identity"] != identity:
                raise AccessError("schedule_plan_device_changed")
            if type(draft_revision) is not int or item["draft_revision"] != draft_revision:
                raise AccessError("revision_conflict")
            self._reserve(item)
            if len(self._state["plans"]) >= MAX_PLANS:
                raise AccessError("schedule_plan_limit")
            del self._pending[token]
            state = deepcopy(self._state)
            state["plans"][item["id"]] = item
            await self._persist(state)
            return self.public(item)

    async def async_recheck(
        self, identifier: str, revision: int, identity: str, inspection: dict[str, Any]
    ) -> dict[str, Any]:
        async with self._lock:
            item = self.get(identifier, revision)
            if item["identity"] != identity:
                raise AccessError("schedule_plan_device_changed")
            if item["revision"] >= 2147483647:
                raise AccessError("schedule_plan_limit")
            item["revision"] += 1
            item["report"] = deepcopy(inspection["report"])
            if not valid_hash(inspection["capability_fingerprint"]):
                raise AccessError("invalid_storage")
            if (
                inspection["capability_fingerprint"] != item["capability_fingerprint"]
                or inspection["capabilities"] != item["capabilities"]
            ):
                item["report"]["blockers"].append("schedule_plan_capabilities_changed")
            current = inspection["fingerprints"]
            if set(current) != set(item["fingerprints"]) or any(
                v is not None and not valid_hash(v) for v in current.values()
            ):
                raise AccessError("invalid_storage")
            item["drifted_resources"] = sorted(
                k for k, v in item["fingerprints"].items() if v != current[k]
            )
            self._validate(item)
            state = deepcopy(self._state)
            state["plans"][identifier] = item
            await self._persist(state)
            return self.public(item)

    async def async_delete(self, identifier: str, revision: int) -> None:
        async with self._lock:
            self.get(identifier, revision)
            state = deepcopy(self._state)
            del state["plans"][identifier]
            await self._persist(state)
