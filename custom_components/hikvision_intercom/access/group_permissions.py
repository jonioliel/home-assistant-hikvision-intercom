"""Resolve group grants and explicit personal exceptions before device reconciliation."""

from __future__ import annotations

from typing import Any

from .models import AccessError, ManagedUser, text_field


def overrides(value: Any) -> dict[str, str]:
    if not isinstance(value, dict) or len(value) > 100:
        raise AccessError("invalid_assignments")
    result = {}
    for key, mode in value.items():
        key = text_field(key, 64)
        if mode not in ("allow", "deny"):
            raise AccessError("invalid_assignments")
        result[key] = mode
    return result


def inherited(settings: dict[str, Any] | None, group_ids: list[str]) -> set[str]:
    return {
        station
        for group in (settings or {}).get("values", {}).get("groups", [])
        if group["enabled"] and group["id"] in group_ids
        for station in group.get("station_ids", [])
    }


def prepare(
    settings: dict[str, Any] | None, data: dict[str, Any], previous: ManagedUser | None
) -> dict[str, Any]:
    """Legacy absolute assignments remain supported; new editors send explicit overrides."""
    from ..profile_settings import group_values

    groups = group_values(data.get("group_ids", previous.group_ids if previous else []))
    grants = inherited(settings, groups)
    if "permission_overrides" in data:
        personal = overrides(data["permission_overrides"])
        if "assignments" in data:
            raise AccessError("invalid_assignments")
    elif "assignments" in data:
        raw = data["assignments"]
        if not isinstance(raw, dict) or len(raw) > 100:
            raise AccessError("invalid_assignments")
        # Validate the legacy payload before deriving its exact effective selection.
        from .models import build_user, utc_now

        checked = build_user(
            data,
            employee_no=previous.employee_no if previous else "100000000",
            now=utc_now(),
            previous=previous,
        )
        selected = {s for s, a in checked.assignments.items() if a.enabled}
        personal = {s: "allow" for s in selected - grants}
        personal.update({s: "deny" for s in grants - selected})
        # Keep explicit disabled legacy rows meaningful without granting access.
        personal.update({s: "deny" for s, a in checked.assignments.items() if not a.enabled})
        if previous:
            # A bulk/CSV edit of another door must not erase an established exception.
            for station, mode in previous.permission_overrides.items():
                before = previous.assignments.get(station)
                if bool(before and before.enabled) == (station in selected):
                    personal[station] = mode
    else:
        personal = dict(previous.permission_overrides) if previous else {}
    allowed = (grants | {s for s, mode in personal.items() if mode == "allow"}) - {
        s for s, mode in personal.items() if mode == "deny"
    }
    stations = allowed | set(personal)
    if len(stations) > 100:
        raise AccessError("invalid_assignments")
    result = {**data, "group_ids": groups, "permission_overrides": personal}
    result["assignments"] = {
        s: {
            "enabled": s in allowed,
            "allowed_locks": [1]
            if s in allowed
            else (
                sorted(previous.assignments[s].allowed_locks)
                if previous and s in previous.assignments
                else []
            ),
        }
        for s in sorted(stations)
    }
    return result
