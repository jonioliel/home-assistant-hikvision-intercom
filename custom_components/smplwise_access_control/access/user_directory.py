"""Bounded, deterministic queries over the public user directory."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime
from typing import Any

from .models import AccessError

_FILTER_KEYS = {"group", "profile", "station", "rights", "state", "credential", "sort"}
_RIGHTS = {"", "assigned", "unassigned", "disabled"}
_STATES = {"", "active", "inactive", "expired", "upcoming"}
_CREDENTIALS = {"", "pin", "no_pin", "card", "no_card"}
_SORTS = {"name", "name_desc", "employee"}


def _text(value: Any, maximum: int = 160) -> str:
    if not isinstance(value, str) or len(value) > maximum or any(ord(c) < 32 for c in value):
        raise AccessError("invalid_fields")
    return value.strip()


def _filters(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) - _FILTER_KEYS:
        raise AccessError("invalid_fields")
    result: dict[str, Any] = {
        "group": _text(value.get("group", ""), 128),
        "station": _text(value.get("station", ""), 128),
        "rights": _text(value.get("rights", ""), 32),
        "state": _text(value.get("state", ""), 32),
        "credential": _text(value.get("credential", ""), 32),
        "sort": _text(value.get("sort", "employee"), 32),
    }
    profile = value.get("profile", {})
    if not isinstance(profile, dict) or len(profile) > 32:
        raise AccessError("invalid_fields")
    result["profile"] = {
        _text(key, 64): _text(item, 256) for key, item in profile.items() if _text(item, 256)
    }
    if (
        result["rights"] not in _RIGHTS
        or result["state"] not in _STATES
        or result["credential"] not in _CREDENTIALS
        or result["sort"] not in _SORTS
    ):
        raise AccessError("invalid_fields")
    return result


def _digits(value: str) -> str:
    return re.sub(r"\D", "", value)


def _instant(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed.astimezone(UTC) if parsed.tzinfo else None


def _natural(value: str) -> tuple[tuple[int, Any], ...]:
    return tuple(
        (0, int(part)) if part.isdigit() else (1, part.casefold())
        for part in re.split(r"(\d+)", value)
        if part
    )


def snapshot_token(users: list[dict[str, Any]]) -> str:
    """Return a privacy-safe token that changes when a public record revision changes."""

    payload = sorted((item["id"], item["revision"]) for item in users)
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=True, separators=(",", ":")).encode()
    ).hexdigest()[:24]


def query_users(
    users: list[dict[str, Any]],
    *,
    query: Any,
    filters: Any,
    offset: Any,
    limit: Any,
    snapshot: Any,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Filter and page already-redacted user projections without exposing secrets."""

    text = _text(query).casefold()
    checked = _filters(filters)
    if type(offset) is not int or offset < 0 or offset > 10_000_000:
        raise AccessError("invalid_fields")
    if type(limit) is not int or not 1 <= limit <= 200:
        raise AccessError("invalid_fields")
    requested_snapshot = _text(snapshot, 64)
    current_snapshot = snapshot_token(users)
    instant = (now or datetime.now(UTC)).astimezone(UTC)
    phone_query = _digits(text)

    def matches(user: dict[str, Any]) -> bool:
        if checked["group"] and checked["group"] not in user.get("group_ids", []):
            return False
        if any(
            expected and user.get("profile", {}).get(identifier) != expected
            for identifier, expected in checked["profile"].items()
        ):
            return False
        haystack = " ".join(
            (user.get("display_name", ""), user.get("employee_no", ""), user.get("phone", ""))
        ).casefold()
        if text and text not in haystack:
            phone_match = (
                bool(re.fullmatch(r"[+0-9 ()-]+", text))
                and len(phone_query) >= 3
                and phone_query in _digits(user.get("phone", ""))
            )
            card_match = (
                len(text) == 4
                and text.isdigit()
                and any(
                    card.get("masked_number", "").endswith(text) for card in user.get("cards", [])
                )
            )
            if not phone_match and not card_match:
                return False
        assignments = user.get("assignments", {})
        selected = (
            [assignments[checked["station"]]]
            if checked["station"] and checked["station"] in assignments
            else []
            if checked["station"]
            else list(assignments.values())
        )
        if checked["station"] and not checked["rights"] and not selected:
            return False
        if checked["rights"] == "assigned" and not any(item.get("enabled") for item in selected):
            return False
        if checked["rights"] == "unassigned" and selected:
            return False
        if checked["rights"] == "disabled" and not any(
            not item.get("enabled") for item in selected
        ):
            return False
        if checked["state"] == "active" and not user.get("active"):
            return False
        if checked["state"] == "inactive" and user.get("active"):
            return False
        if checked["state"] == "expired":
            expires = _instant(user.get("valid_until"))
            if expires is None or expires > instant:
                return False
        if checked["state"] == "upcoming":
            starts = _instant(user.get("valid_from"))
            if starts is None or starts <= instant:
                return False
        has_card = any(card.get("enabled") for card in user.get("cards", []))
        credential = checked["credential"]
        if (
            credential == "pin"
            and not user.get("pin_configured")
            or credential == "no_pin"
            and user.get("pin_configured")
            or credential == "card"
            and not has_card
            or credential == "no_card"
            and has_card
        ):
            return False
        return True

    records = [item for item in users if matches(item)]
    if checked["sort"] == "employee":
        records.sort(key=lambda item: (_natural(item.get("employee_no", "")), item["id"]))
    else:
        # Match the browser's stable tie-break: names may reverse, immutable IDs do not.
        records.sort(key=lambda item: item["id"])
        records.sort(
            key=lambda item: item.get("display_name", "").casefold(),
            reverse=checked["sort"] == "name_desc",
        )
    total = len(records)
    effective_offset = min(offset, ((total - 1) // limit) * limit) if total else 0
    page = records[effective_offset : effective_offset + limit]
    return {
        "records": page,
        "total": total,
        "total_all": len(users),
        "offset": effective_offset,
        "limit": limit,
        "next_offset": effective_offset + limit if effective_offset + limit < total else None,
        "previous_offset": max(0, effective_offset - limit) if effective_offset else None,
        "snapshot": current_snapshot,
        "stale": bool(requested_snapshot and requested_snapshot != current_snapshot),
    }
