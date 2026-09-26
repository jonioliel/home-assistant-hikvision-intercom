"""Strict projection of observed schedule fields; comparison is not enforcement proof."""

from __future__ import annotations

import re
from typing import Any

from .models import AccessError
from .schedule_compiler import ROOTS
from .schedules import DAYS, calendar_date

ID_KEYS = {
    "template": "planTemplateID",
    "weekly": "weekPlanID",
    "holiday_group": "holidayGroupID",
    "holiday": "holidayPlanID",
}


def canonical(kind: str, value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise AccessError("schedule_observation_invalid")
    value = value.get(ROOTS[kind], value)
    if not isinstance(value, dict) or type(value.get("enable")) is not bool:
        raise AccessError("schedule_observation_invalid")
    allowed = {"enable", ID_KEYS[kind]}
    result: dict[str, Any] = {"enable": value["enable"]}
    if kind in {"template", "holiday_group"}:
        name, refs = (
            ("templateName", "holidayGroupNo")
            if kind == "template"
            else ("groupName", "holidayPlanNo")
        )
        allowed.update((name, refs))
        if not isinstance(value.get(name), str) or len(value[name]) > 64:
            raise AccessError("schedule_observation_invalid")
        raw = value.get(refs)
        if not isinstance(raw, str) or len(raw) > 8192:
            raise AccessError("schedule_observation_invalid")
        parts = raw.split(",") if raw else []
        if len(parts) > 1024 or any(
            not re.fullmatch(r"[0-9]{1,5}", p) or not 1 <= int(p) <= 65535 for p in parts
        ):
            raise AccessError("schedule_observation_invalid")
        ids = [int(p) for p in parts]
        if len(set(ids)) != len(ids):
            raise AccessError("schedule_observation_invalid")
        result.update({name: value[name], refs: sorted(ids)})
        if kind == "template":
            allowed.add("weekPlanNo")
            week = value.get("weekPlanNo")
            if type(week) is not int or not 1 <= week <= 65535:
                raise AccessError("schedule_observation_invalid")
            result["weekPlanNo"] = week
        else:
            # Manufacturer GET-only display labels, not writable permission fields.
            allowed.add("holidayPlanName")
    else:
        key = "WeekPlanCfg" if kind == "weekly" else "HolidayPlanCfg"
        allowed.add(key)
        if kind == "holiday":
            allowed.update(("beginDate", "endDate", "holidayPlanName"))
            for field in ("beginDate", "endDate"):
                date = value.get(field)
                if date != "0000-00-00" or value["enable"]:
                    calendar_date(date)
                result[field] = date
        rows = value.get(key)
        if not isinstance(rows, list) or len(rows) > (56 if kind == "weekly" else 8):
            raise AccessError("schedule_observation_invalid")
        periods = []
        seen = set()
        for row in rows:
            if not isinstance(row, dict):
                raise AccessError("schedule_observation_invalid")
            fields = {"id", "enable", "TimeSegment"} | ({"week"} if kind == "weekly" else set())
            if set(row) - fields:
                raise AccessError("schedule_observation_extra_fields")
            if (
                type(row.get("id")) is not int
                or not 1 <= row["id"] <= 8
                or type(row.get("enable")) is not bool
            ):
                raise AccessError("schedule_observation_invalid")
            week = row.get("week") if kind == "weekly" else None
            if kind == "weekly" and week not in DAYS:
                raise AccessError("schedule_observation_invalid")
            pair = (week, row["id"])
            if pair in seen:
                raise AccessError("schedule_observation_invalid")
            seen.add(pair)
            segment = row.get("TimeSegment")
            if not isinstance(segment, dict) or set(segment) != {"beginTime", "endTime"}:
                raise AccessError("schedule_observation_invalid")
            for field in ("beginTime", "endTime"):
                time = segment[field]
                if not isinstance(time, str) or not re.fullmatch(
                    r"(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]", time
                ):
                    if field != "endTime" or time != "24:00:00":
                        raise AccessError("schedule_observation_invalid")
            if row["enable"] and segment["beginTime"] >= segment["endTime"]:
                raise AccessError("schedule_observation_invalid")
            periods.append(
                {
                    **({"week": week} if week else {}),
                    "id": row["id"],
                    "enable": row["enable"],
                    "TimeSegment": dict(segment),
                }
            )
        result[key] = sorted(
            periods, key=lambda r: (DAYS.index(r["week"]) if kind == "weekly" else 0, r["id"])
        )
    if set(value) - allowed:
        raise AccessError("schedule_observation_extra_fields")
    return result


def compare_resource(kind: str, desired: dict[str, Any], observed: Any) -> dict[str, Any]:
    if observed is None:
        return {"state": "not_observed", "fields": [], "active": None}
    try:
        expected, actual = canonical(kind, desired), canonical(kind, observed)
    except AccessError as err:
        return {
            "state": "unsupported"
            if err.code == "schedule_observation_extra_fields"
            else "unreadable",
            "fields": [],
            "active": None,
        }
    fields = sorted(key for key in expected if expected[key] != actual[key])
    return {
        "state": "different" if fields else "matches",
        "fields": fields,
        "active": actual["enable"],
    }
