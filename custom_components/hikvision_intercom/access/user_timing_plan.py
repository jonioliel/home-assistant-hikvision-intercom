"""Compile a user's wall-clock proposal without granting or activating permissions.

The vendor defines schedule segments in station-local time (pp. 445-446).
Calendar exceptions use a deny-all base week. They never become a repeating weekly
allow-list, and compilation does not prove holiday membership/enforcement.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import date, timedelta
from typing import Any

from .models import AccessError
from .schedule_compiler import compile_schedule
from .schedules import DAYS, normalize
from .user_timing import timing_draft


def user_schedule(value: Any, *, name: str = "WisKey") -> dict[str, Any]:
    timing = timing_draft(value)
    if timing is None:
        raise AccessError("invalid_user_timing")
    weekly: dict[str, list[dict[str, str]]] = {day: [] for day in DAYS}
    holidays: list[dict[str, Any]] = []
    if timing["mode"] == "weekly":
        for day in timing["days"]:
            weekly[day] = deepcopy(timing["periods"])
    else:
        # Coalesce only adjacent calendar dates. Never bridge an unselected day.
        for text in timing["dates"]:
            current = date.fromisoformat(text)
            if holidays and date.fromisoformat(holidays[-1]["end"]) + timedelta(days=1) == current:
                holidays[-1]["end"] = text
            else:
                holidays.append(
                    {
                        "name": f"WisKey {text}",
                        "start": text,
                        "end": text,
                        "periods": deepcopy(timing["periods"]),
                    }
                )
    return normalize({"name": name, "weekly": weekly, "holidays": holidays})


def right_plan(doors: Any, template: Any, capability: Any) -> list[dict[str, Any]]:
    """Require observed UserInfo RightPlan limits, not just schedule resource limits."""
    if (
        not isinstance(doors, (list, tuple))
        or not doors
        or any(type(d) is not int or d not in (1, 2) for d in doors)
        or len(set(doors)) != len(doors)
        or type(template) is not int
        or not 1 <= template <= 65532
    ):
        raise AccessError("schedule_binding_invalid")
    if not isinstance(capability, dict):
        raise AccessError("schedule_user_capability_unknown")
    maximum, plans = capability.get("maxSize"), capability.get("maxPlanTemplate")
    if (
        type(maximum) is not int
        or not len(doors) <= maximum <= 128
        or type(plans) is not int
        or not 1 <= plans <= 4
    ):
        raise AccessError("schedule_user_capability_unknown")
    for field, values in (("doorNo", doors), ("planTemplateNo", [template])):
        bounds = capability.get(field)
        if not isinstance(bounds, dict):
            raise AccessError("schedule_user_capability_unknown")
        low, high = bounds.get("@min"), bounds.get("@max")
        if (
            type(low) is not int
            or type(high) is not int
            or not 1 <= low <= high <= 65535
            or any(not low <= v <= high for v in values)
        ):
            raise AccessError("schedule_binding_invalid")
    # Reserved all-day/weekend identifiers must never bypass a user's restriction.
    return [{"doorNo": door, "planTemplateNo": str(template)} for door in sorted(doors)]


def prepare_user_timing(
    value: Any,
    bindings: Any,
    capabilities: dict[str, Any],
    *,
    doors: Any,
    user_capability: Any,
    station_timezone: str | None,
) -> dict[str, Any]:
    timing = timing_draft(value)
    if timing is None:
        raise AccessError("invalid_user_timing")
    # A display override or today's UTC offset is not proof of station DST rules.
    if station_timezone != timing["timezone"]:
        raise AccessError("schedule_station_timezone_unverified")
    draft = user_schedule(timing)
    resources = compile_schedule(draft, bindings, capabilities)
    assignment = right_plan(doors, bindings["template"], user_capability)
    return {
        "timezone": timing["timezone"],
        "draft": draft,
        "resources": resources,
        "RightPlan": assignment,
        "requires_holiday_verification": bool(draft["holidays"]),
        "applied": False,
        "physical_verified": False,
    }
