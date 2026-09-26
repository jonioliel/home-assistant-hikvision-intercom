"""Bounded read-only schedule readiness from vendor pages 123-126 and 438-447.

An advertised capability or successful GET does not enable any schedule mutation.
Only the first advertised identifier is sampled; errors never mean an empty slot.
"""

from __future__ import annotations

import asyncio
from typing import Any

from ..access.diagnostics import error_code
from ..access.models import utc_now
from ..exceptions import (
    HikvisionAuthError,
    HikvisionConnectionError,
    HikvisionError,
    HikvisionTimeoutError,
    HikvisionValidationError,
)
from .client import HikvisionClient
from .parser import find_values

ROUTES = (
    ("template", "UserRightPlanTemplate", "isSupportUserRightPlanTemplate", "templateNo"),
    ("weekly", "UserRightWeekPlanCfg", "isSupportCardRightWeekPlanCfg", "planNo"),
    ("holiday_group", "UserRightHolidayGroupCfg", "isSupportUserRightHolidayGroupCfg", "groupNo"),
    ("holiday", "UserRightHolidayPlanCfg", "isSupportCardRightHolidayPlanCfg", "planNo"),
)


def bounds(value: Any, *, ceiling: int = 65535) -> list[int]:
    if not isinstance(value, dict):
        raise HikvisionValidationError("Missing schedule bounds")
    low, high = value.get("@min"), value.get("@max")
    if type(low) is not int or type(high) is not int or not 1 <= low <= high <= ceiling:
        raise HikvisionValidationError("Invalid schedule bounds")
    return [low, high]


def capability(payload: dict[str, Any], root: str, selector: str) -> dict[str, Any]:
    value = payload.get(root)
    if not isinstance(value, dict):
        raise HikvisionValidationError("Missing schedule capability")
    result: dict[str, Any] = {"ids": bounds(value.get(selector))}
    for source, target in (
        ("weekPlanNo", "week_ids"),
        ("holidayGroupNo", "group_ids"),
        ("holidayPlanNo", "holiday_ids"),
    ):
        if source in value:
            result[target] = bounds(value[source])
    name = value.get("templateName" if root == "UserRightPlanTemplate" else "groupName")
    if isinstance(name, dict):
        low, high = name.get("@min"), name.get("@max")
        if type(low) is int and type(high) is int and 0 <= low <= high <= 64:
            result["name_length"] = [low, high]
    segment = value.get("WeekPlanCfg" if root == "UserRightWeekPlanCfg" else "HolidayPlanCfg")
    if root in {"UserRightWeekPlanCfg", "UserRightHolidayPlanCfg"}:
        if not isinstance(segment, dict):
            raise HikvisionValidationError("Missing time capability")
        result["period_ids"] = bounds(segment.get("id"), ceiling=8)
        count = segment.get("maxSize")
        if type(count) is not int or not 1 <= count <= 56:
            raise HikvisionValidationError("Invalid period count")
        result["max_periods"] = count
        time_segment = segment.get("TimeSegment")
        if not isinstance(time_segment, dict):
            raise HikvisionValidationError("Missing time capability")
        unit = time_segment.get("validUnit", "minute")
        if not isinstance(unit, str) or unit not in {"hour", "minute", "second"}:
            raise HikvisionValidationError("Unknown time precision")
        result["precision"] = unit
    return result


def check_sample(payload: dict[str, Any], root: str) -> None:
    value = payload.get(root)
    if not isinstance(value, dict) or type(value.get("enable")) is not bool:
        raise HikvisionValidationError("Missing schedule configuration")
    if root == "UserRightPlanTemplate":
        if (
            not isinstance(value.get("templateName"), str)
            or type(value.get("weekPlanNo")) is not int
            or not isinstance(value.get("holidayGroupNo"), str)
        ):
            raise HikvisionValidationError("Invalid template configuration")
    elif root == "UserRightHolidayGroupCfg":
        if not isinstance(value.get("groupName"), str) or not isinstance(
            value.get("holidayPlanNo"), str
        ):
            raise HikvisionValidationError("Invalid holiday group configuration")
    elif not isinstance(
        value.get("WeekPlanCfg" if root == "UserRightWeekPlanCfg" else "HolidayPlanCfg"), list
    ):
        raise HikvisionValidationError("Missing time periods")


async def inspect_schedules(client: HikvisionClient) -> dict[str, Any]:
    results: list[dict[str, Any]] = [
        dict(
            kind=kind,
            advertised=None,
            capabilities=None,
            sample_id=None,
            read_state="not_checked",
            error=None,
        )
        for kind, *_ in ROUTES
    ]
    try:
        async with asyncio.timeout(35):
            await client.async_confirm_identity()
            access = await client._get("/ISAPI/AccessControl/capabilities")
            for item, (_, root, flag, selector) in zip(results, ROUTES, strict=True):
                flags = find_values(access, flag)
                item["advertised"] = len(flags) == 1 and (flags[0] is True or flags[0] == "true")
                if not item["advertised"]:
                    item.update(read_state="unsupported", error="operation_unsupported")
                    continue
                try:
                    cap = capability(
                        await client._get(f"/ISAPI/AccessControl/{root}/capabilities?format=json"),
                        root,
                        selector,
                    )
                    item["capabilities"] = cap
                    item["sample_id"] = cap["ids"][0]
                    sample = await client._get(
                        f"/ISAPI/AccessControl/{root}/{item['sample_id']}?format=json"
                    )
                    check_sample(sample, root)
                    item["read_state"] = "readable"
                except (HikvisionAuthError, HikvisionConnectionError, HikvisionTimeoutError):
                    raise
                except HikvisionError as err:
                    item.update(read_state="failed", error=error_code(err))
    except (HikvisionError, TimeoutError) as err:
        code = "connection_failed" if isinstance(err, TimeoutError) else error_code(err)
        for item in results:
            if item["read_state"] == "not_checked":
                item.update(read_state="failed", error=code)
    return {
        "checked_at": utc_now(),
        "checks": results,
        "can_apply": False,
        "reason": "schedule_writes_unverified",
        "sample_only": True,
    }
