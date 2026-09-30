"""Compile candidate schedule bodies from documented fields. Contains no network writer.

Compilation proves representation only, not ownership, firmware acceptance or enforcement.
"""

from __future__ import annotations

from typing import Any

from .models import AccessError
from .schedules import DAYS, minute, normalize

ROOTS = {
    "template": "UserRightPlanTemplate",
    "weekly": "UserRightWeekPlanCfg",
    "holiday_group": "UserRightHolidayGroupCfg",
    "holiday": "UserRightHolidayPlanCfg",
}


def bindings_for(data: Any, holiday_count: int) -> dict[str, Any]:
    if not isinstance(data, dict) or set(data) != {
        "template",
        "weekly",
        "holiday_group",
        "holidays",
    }:
        raise AccessError("schedule_binding_invalid")
    holidays = data["holidays"]
    if not isinstance(holidays, list) or len(holidays) != holiday_count:
        raise AccessError("schedule_binding_invalid")
    ids = [data["template"], data["weekly"], *holidays]
    if holiday_count:
        ids.append(data["holiday_group"])
    elif data["holiday_group"] is not None:
        raise AccessError("schedule_binding_invalid")
    if any(type(i) is not int or not 1 <= i <= 65535 for i in ids) or len(set(holidays)) != len(
        holidays
    ):
        raise AccessError("schedule_binding_invalid")
    return {**data, "holidays": list(holidays)}


def compile_schedule(draft: Any, bindings: Any, caps: dict[str, Any]) -> list[dict[str, Any]]:
    draft = normalize(draft)
    slots = bindings_for(bindings, len(draft["holidays"]))
    resources: list[dict[str, Any]] = []

    def check_range(value: int, cap: dict[str, Any], key: str) -> None:
        limits = cap.get(key)
        if (
            not isinstance(limits, list)
            or len(limits) != 2
            or any(type(n) is not int for n in limits)
            or not 0 <= limits[0] <= limits[1] <= 65535
        ):
            raise AccessError("schedule_compilation_unknown")
        if not limits[0] <= value <= limits[1]:
            raise AccessError("schedule_binding_out_of_range")

    def capability(kind: str, identifier: int) -> dict[str, Any]:
        cap = caps.get(kind)
        if not isinstance(cap, dict):
            raise AccessError("schedule_compilation_unknown")
        check_range(identifier, cap, "ids")
        return cap

    def named(name: str, cap: dict[str, Any]) -> str:
        check_range(len(name), cap, "name_length")
        return name

    def periods(
        windows: list[dict[str, str]], cap: dict[str, Any], week: str | None = None
    ) -> list[dict[str, Any]]:
        bounds = cap.get("period_ids")
        if (
            not isinstance(bounds, list)
            or len(bounds) != 2
            or any(type(n) is not int for n in bounds)
            or not 1 <= bounds[0] <= bounds[1] <= 8
            or cap.get("precision") not in ("hour", "minute", "second")
        ):
            raise AccessError("schedule_compilation_unknown")
        if len(windows) > bounds[1] - bounds[0] + 1:
            raise AccessError("schedule_compilation_limit")
        result = []
        for index, identifier in enumerate(range(bounds[0], bounds[1] + 1)):
            p = windows[index] if index < len(windows) else None
            if (
                p
                and cap["precision"] == "hour"
                and any(minute(p[k], end=k == "end") % 60 for k in ("start", "end"))
            ):
                raise AccessError("schedule_compilation_limit")
            result.append(
                {
                    **({"week": week} if week else {}),
                    "id": identifier,
                    "enable": p is not None,
                    "TimeSegment": {
                        "beginTime": p["start"] + ":00" if p else "00:00:00",
                        "endTime": p["end"] + ":00" if p else "00:00:00",
                    },
                }
            )
        return result

    def add(kind: str, identifier: int, body: dict[str, Any], dependencies: list[str]) -> None:
        resources.append(
            {
                "key": f"{kind}:{identifier}",
                "kind": kind,
                "id": identifier,
                "dependencies": dependencies,
                "body": {ROOTS[kind]: body},
            }
        )

    def count(rows: list[dict[str, Any]], cap: dict[str, Any]) -> None:
        maximum = cap.get("max_periods")
        if type(maximum) is not int or not 1 <= maximum <= 56:
            raise AccessError("schedule_compilation_unknown")
        if len(rows) > maximum:
            raise AccessError("schedule_compilation_limit")

    week_cap = capability("weekly", slots["weekly"])
    weekdays = week_cap.get("weekdays")
    if not isinstance(weekdays, list) or set(weekdays) != set(DAYS):
        raise AccessError("schedule_compilation_unknown")
    week_rows = [p for day in DAYS for p in periods(draft["weekly"][day], week_cap, day)]
    count(week_rows, week_cap)
    add("weekly", slots["weekly"], {"enable": True, "WeekPlanCfg": week_rows}, [])
    holiday_refs = []
    for holiday, identifier in zip(draft["holidays"], slots["holidays"], strict=True):
        cap = capability("holiday", identifier)
        rows = periods(holiday["periods"], cap)
        count(rows, cap)
        add(
            "holiday",
            identifier,
            {
                "enable": True,
                "beginDate": holiday["start"],
                "endDate": holiday["end"],
                "HolidayPlanCfg": rows,
            },
            [],
        )
        holiday_refs.append(f"holiday:{identifier}")
    dependencies = [f"weekly:{slots['weekly']}"]
    if holiday_refs:
        cap = capability("holiday_group", slots["holiday_group"])
        for identifier in slots["holidays"]:
            check_range(identifier, cap, "holiday_ids")
        add(
            "holiday_group",
            slots["holiday_group"],
            {
                "enable": True,
                "groupName": named(draft["name"], cap),
                "holidayPlanNo": ",".join(map(str, slots["holidays"])),
            },
            holiday_refs,
        )
        dependencies.append(f"holiday_group:{slots['holiday_group']}")
    cap = capability("template", slots["template"])
    check_range(slots["weekly"], cap, "week_ids")
    if holiday_refs:
        check_range(slots["holiday_group"], cap, "group_ids")
    add(
        "template",
        slots["template"],
        {
            "enable": True,
            "templateName": named(draft["name"], cap),
            "weekPlanNo": slots["weekly"],
            "holidayGroupNo": str(slots["holiday_group"]) if holiday_refs else "",
        },
        dependencies,
    )
    return resources
