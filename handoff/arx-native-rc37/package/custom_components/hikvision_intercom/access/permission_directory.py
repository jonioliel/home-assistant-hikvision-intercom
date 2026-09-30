"""Bounded central permission directory; desired rights are never device acceptance."""

from datetime import UTC, datetime
from typing import Any

from .models import AccessError, ManagedUser, text_field


def directory(state: dict[str, Any], filters: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(filters, dict) or set(filters) - {
        "station_id",
        "mode",
        "search",
        "offset",
        "limit",
    }:
        raise AccessError("invalid_fields")
    station_id = text_field(filters.get("station_id", ""), 128, empty=True)
    search = text_field(filters.get("search", ""), 128, empty=True).casefold()
    mode = filters.get("mode", "allowed")
    offset, limit = filters.get("offset", 0), filters.get("limit", 50)
    if (
        not isinstance(mode, str)
        or mode not in {"allowed", "all", "exceptions"}
        or type(offset) is not int
        or type(limit) is not int
        or not 0 <= offset <= 100000
        or not 1 <= limit <= 200
    ):
        raise AccessError("invalid_fields")
    groups = (state["profile_settings"] or {}).get("values", {}).get("groups", [])
    now = datetime.now(UTC)
    rows: list[dict[str, Any]] = []
    for raw in state["users"].values():
        user = ManagedUser.from_private(raw)
        if search and search not in (user.display_name + " " + user.employee_no).casefold():
            continue
        condition = "active"
        if not user.active:
            condition = "inactive"
        elif user.valid_from and datetime.fromisoformat(user.valid_from) > now:
            condition = "upcoming"
        elif user.valid_until and datetime.fromisoformat(user.valid_until) <= now:
            condition = "expired"
        doors = []
        ids = {station_id} if station_id else set(user.assignments) | set(user.permission_overrides)
        for sid in sorted(ids):
            a = user.assignments.get(sid)
            override = user.permission_overrides.get(sid)
            sources = [
                g["label"]
                for g in groups
                if g["enabled"] and g["id"] in user.group_ids and sid in g.get("station_ids", [])
            ]
            selected = bool(a and a.enabled)
            doors.append(
                {
                    "station_id": sid,
                    "selected": selected,
                    "allowed": selected and condition == "active",
                    "override": override,
                    "groups": sources,
                    "sync_state": a.sync_state if a else None,
                    "desired_revision": a.desired_revision if a else None,
                    "applied_revision": a.applied_revision if a else None,
                }
            )
        if mode == "allowed" and not any(d["allowed"] for d in doors):
            continue
        if mode == "exceptions" and not any(d["override"] for d in doors):
            continue
        rows.append(
            {
                "user_id": user.id,
                "revision": user.revision,
                "display_name": user.display_name,
                "employee_no": user.employee_no,
                "condition": condition,
                "doors": doors,
            }
        )
    rows.sort(key=lambda r: (r["display_name"].casefold(), r["employee_no"], r["user_id"]))
    return {
        "rows": rows[offset : offset + limit],
        "total": len(rows),
        "offset": offset,
        "limit": limit,
        "generated_at": now.isoformat(),
        "source": "central_policy",
        "device_writes": 0,
    }
