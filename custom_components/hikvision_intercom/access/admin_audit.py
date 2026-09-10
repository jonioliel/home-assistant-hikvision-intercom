"""Atomic, bounded administrative change evidence; credential values never enter it."""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import Any

from .csv_transfer import csv_text, desired_fields
from .models import AccessError, ManagedUser, text_field, utc_now

LIMIT = 5000
DAYS = 30
ACTIONS = frozenset(
    {
        "profiles/settings_update",
        "users/create",
        "users/update",
        "users/delete",
        "users/set_active",
        "cards/add",
        "cards/remove",
        "users/csv_apply",
        "users/adopt",
        "users/delete_unmanaged",
        "users/ignore",
        "cards/capture_confirm",
        "conflicts/resolve",
        "conflicts/resolve_deletion",
        "bulk/enable",
        "bulk/disable",
        "bulk/assign",
        "bulk/unassign",
        "bulk/delete",
        "bulk/remove_pin",
        "bulk/remove_cards",
        "bulk/sync",
        "bulk/profile",
        "bulk/group_add",
        "bulk/group_remove",
        "bulk/reset_overrides",
        "bulk/group_policy",
        "system",
    }
)
_context: ContextVar[tuple[str, str, asyncio.Task[Any] | None] | None] = ContextVar(
    "access_audit", default=None
)


@contextmanager
def audit_actor(actor: str, action: str) -> Iterator[None]:
    action = action if action in ACTIONS else "system"
    token = _context.set((text_field(actor, 128, empty=True), action, asyncio.current_task()))
    try:
        yield
    finally:
        _context.reset(token)


def current_actor() -> tuple[str, str]:
    item = _context.get()
    # Child reconciliation tasks inherit ContextVars but must not inherit authorship.
    if item is None or item[2] is not asyncio.current_task():
        return "", "system"
    return item[:2]


def summary(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    if raw is None:
        return None
    return {
        "display_name": raw["display_name"],
        "employee_no": raw["employee_no"],
        "active": raw["active"],
        "user_type": raw["user_type"],
        "valid_from": raw["valid_from"],
        "valid_until": raw["valid_until"],
        "pin_configured": raw["pin"] is not None,
        "card_count": len(raw["cards"]),
        "enabled_cards": sum(card["enabled"] for card in raw["cards"]),
        "assignments": {
            sid: {"enabled": a["enabled"], "allowed_locks": a["allowed_locks"]}
            for sid, a in raw["assignments"].items()
        },
    }


def changes(before: dict[str, Any] | None, after: dict[str, Any] | None) -> list[str]:
    first = desired_fields(ManagedUser.from_private(before)) if before else {}
    last = desired_fields(ManagedUser.from_private(after)) if after else {}
    for key in ("profile", "group_ids", "photo", "permission_overrides"):
        first[key] = (before or {}).get(key)
        last[key] = (after or {}).get(key)
    return sorted(key for key in first.keys() | last.keys() if first.get(key) != last.get(key))


def append_changes(old: dict[str, Any], new: dict[str, Any], actor: str, action: str) -> None:
    audit = new["admin_audit"]
    now = utc_now()
    cutoff = (datetime.now(UTC) - timedelta(days=DAYS)).isoformat(timespec="seconds")
    audit["records"] = [r for r in audit["records"] if r["time"] >= cutoff]
    ids = old["users"].keys() | new["users"].keys()
    if action == "users/delete_unmanaged":
        ids |= new["tombstones"].keys() - old["tombstones"].keys()
    elif action == "conflicts/resolve_deletion":
        ids |= old["tombstones"].keys() | new["tombstones"].keys()
    for uid in sorted(ids):
        before, after = old["users"].get(uid), new["users"].get(uid)
        if before is None and after is None:
            before = (old["tombstones"].get(uid) or new["tombstones"].get(uid) or {}).get("record")
            after = None if action == "users/delete_unmanaged" else before
        if (
            before
            and after
            and before["revision"] == after["revision"]
            and action not in {"conflicts/resolve", "conflicts/resolve_deletion", "users/adopt"}
        ):
            continue
        fields = changes(before, after)
        stations = sorted(
            set((before or {}).get("assignments", {}))
            | set((after or {}).get("assignments", {}))
            | {
                sid
                for state in (old, new)
                for sid, bindings in state["bindings"].items()
                if uid in bindings
            }
        )
        binding_changed = action in {
            "conflicts/resolve",
            "conflicts/resolve_deletion",
            "users/adopt",
        } and any(
            old["bindings"].get(sid, {}).get(uid) != new["bindings"].get(sid, {}).get(uid)
            for sid in stations
        )
        if not fields and not binding_changed:
            continue
        audit["records"].append(
            {
                "sequence": audit["next"],
                "time": now,
                "actor": actor,
                "action": action,
                "user_id": uid,
                "stations": stations,
                "fields": fields or ["ownership"],
                "before": summary(before),
                "after": summary(after),
                "revision_before": before["revision"] if before else None,
                "revision_after": after["revision"] if after else None,
            }
        )
        audit["next"] += 1
    audit["records"] = audit["records"][-LIMIT:]


def validate_storage(audit: Any, receipts: Any) -> None:
    if (
        not isinstance(audit, dict)
        or set(audit) != {"next", "records"}
        or type(audit["next"]) is not int
        or audit["next"] < 1
    ):
        raise AccessError("invalid_storage")
    if (
        not isinstance(audit["records"], list)
        or len(audit["records"]) > LIMIT
        or not isinstance(receipts, dict)
        or len(receipts) > 1000
    ):
        raise AccessError("invalid_storage")
    previous = 0
    for row in audit["records"]:
        if not isinstance(row, dict) or set(row) != {
            "sequence",
            "time",
            "actor",
            "action",
            "user_id",
            "stations",
            "fields",
            "before",
            "after",
            "revision_before",
            "revision_after",
        }:
            raise AccessError("invalid_storage")
        if (
            type(row["sequence"]) is not int
            or not previous < row["sequence"] < audit["next"]
            or row["action"] not in ACTIONS
        ):
            raise AccessError("invalid_storage")
        previous = row["sequence"]
        for key in ("time", "actor", "user_id"):
            text_field(row[key], 128, empty=key == "actor")
        _instant(row["time"])
        if not isinstance(row["stations"], list) or not isinstance(row["fields"], list):
            raise AccessError("invalid_storage")
        for sid in row["stations"]:
            text_field(sid, 128)
        allowed_fields = {
            "employee_no",
            "display_name",
            "active",
            "user_type",
            "valid_from",
            "valid_until",
            "pin",
            "cards",
            "assignments",
            "ownership",
            "profile",
            "group_ids",
            "photo",
            "permission_overrides",
        }
        if any(not isinstance(f, str) or f not in allowed_fields for f in row["fields"]):
            raise AccessError("invalid_storage")
        for side in ("before", "after"):
            item = row[side]
            if item is None:
                continue
            if not isinstance(item, dict) or set(item) != {
                "display_name",
                "employee_no",
                "active",
                "user_type",
                "valid_from",
                "valid_until",
                "pin_configured",
                "card_count",
                "enabled_cards",
                "assignments",
            }:
                raise AccessError("invalid_storage")
            for key in ("display_name", "employee_no", "user_type"):
                text_field(item[key], 128)
            if any(type(item[key]) is not bool for key in ("active", "pin_configured")) or any(
                type(item[key]) is not int or item[key] < 0
                for key in ("card_count", "enabled_cards")
            ):
                raise AccessError("invalid_storage")
            for key in ("valid_from", "valid_until"):
                if item[key] is not None:
                    _instant(item[key])
            if not isinstance(item["assignments"], dict):
                raise AccessError("invalid_storage")
            for sid, a in item["assignments"].items():
                text_field(sid, 128)
                if (
                    not isinstance(a, dict)
                    or set(a) != {"enabled", "allowed_locks"}
                    or type(a["enabled"]) is not bool
                    or not isinstance(a["allowed_locks"], list)
                    or any(type(lock) is not int for lock in a["allowed_locks"])
                    or a["allowed_locks"] not in ([], [1])
                    or (a["enabled"] and a["allowed_locks"] != [1])
                ):
                    raise AccessError("invalid_storage")
        if any(
            row[k] is not None and (type(row[k]) is not int or row[k] < 1)
            for k in ("revision_before", "revision_after")
        ):
            raise AccessError("invalid_storage")
    for key, receipt in receipts.items():
        if (
            not isinstance(receipt, dict)
            or set(receipt)
            != {"operation_id", "actor", "action", "saved_at", "user_ids", "changed", "stations"}
            or receipt["operation_id"] != key
        ):
            raise AccessError("invalid_storage")
        text_field(key, 128)
        text_field(receipt["actor"], 128)
        _instant(receipt["saved_at"])
        if (
            receipt["action"] not in ACTIONS
            or not receipt["action"].startswith("bulk/")
            or type(receipt["changed"]) is not int
            or not 0
            <= receipt["changed"]
            <= (10000 if receipt["action"] == "bulk/group_policy" else 200)
        ):
            raise AccessError("invalid_storage")
        for field in ("user_ids", "stations"):
            if not isinstance(receipt[field], list) or len(receipt[field]) > (
                10000 if field == "user_ids" and receipt["action"] == "bulk/group_policy" else 200
            ):
                raise AccessError("invalid_storage")
            for value in receipt[field]:
                text_field(value, 128)


def _instant(value: Any) -> str:
    try:
        if not isinstance(value, str) or len(value) > 40:
            raise ValueError
        when = datetime.fromisoformat(value)
        if when.tzinfo is None:
            raise ValueError
        return when.astimezone(UTC).isoformat(timespec="seconds")
    except (ValueError, OverflowError):
        raise AccessError("invalid_fields") from None


def query(
    audit: dict[str, Any], filters: dict[str, Any], *, exporting: bool = False
) -> dict[str, Any]:
    if not isinstance(filters, dict) or set(filters) - {
        "user_id",
        "station_id",
        "action",
        "actor",
        "start",
        "end",
        "before",
        "limit",
    }:
        raise AccessError("invalid_fields")
    filters = dict(filters)
    for key in ("user_id", "station_id", "actor", "action"):
        if key in filters:
            text_field(filters[key], 128)
    if "action" in filters and filters["action"] not in ACTIONS:
        raise AccessError("invalid_fields")
    for key in ("start", "end"):
        if key in filters:
            filters[key] = _instant(filters[key])
    if filters.get("start", "") > filters.get("end", "9999"):
        raise AccessError("invalid_fields")
    before = filters.get("before", audit["next"])
    limit = filters.get("limit", 50)
    if type(before) is not int or before < 1 or type(limit) is not int or not 1 <= limit <= 100:
        raise AccessError("invalid_fields")
    cutoff = (datetime.now(UTC) - timedelta(days=DAYS)).isoformat(timespec="seconds")
    rows = [
        r
        for r in reversed(audit["records"])
        if r["time"] >= cutoff
        and (exporting or r["sequence"] < before)
        and all(r[key] == filters[key] for key in ("user_id", "action", "actor") if key in filters)
        and ("station_id" not in filters or filters["station_id"] in r["stations"])
        and filters.get("start", "") <= r["time"] <= filters.get("end", "9999")
    ]
    shown = rows if exporting else rows[:limit]
    return deepcopy(
        {
            "records": shown,
            "next_cursor": shown[-1]["sequence"] if len(rows) > len(shown) else None,
            "total": len(rows),
            "retention_days": DAYS,
            "retention_limit": LIMIT,
        }
    )


def export(audit: dict[str, Any], filters: dict[str, Any]) -> dict[str, Any]:
    report = query(audit, filters, exporting=True)
    report["format"] = "hikvision_intercom.admin_audit"
    report["schema"] = 1
    report["csv"] = csv_text(
        [
            "time_utc",
            "actor_id",
            "action",
            "user_id",
            "name",
            "employee_no",
            "stations",
            "changed_fields",
            "revision_before",
            "revision_after",
        ],
        (
            [
                r["time"],
                r["actor"],
                r["action"],
                r["user_id"],
                (r["after"] or r["before"] or {}).get("display_name", ""),
                (r["after"] or r["before"] or {}).get("employee_no", ""),
                ";".join(r["stations"]),
                ";".join(r["fields"]),
                r["revision_before"],
                r["revision_after"],
            ]
            for r in report["records"]
        ),
    )
    return report
