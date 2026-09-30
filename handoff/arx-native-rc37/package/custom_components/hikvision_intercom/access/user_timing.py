"""Validated user timing proposals, deliberately separate from enforced validity.

These records never enter UserInfo/RightPlan. Native schedule deployment must first
prove resource ownership and station enforcement; saving a proposal is not a grant.
"""

from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .models import AccessError


def timing_draft(value: Any) -> dict[str, Any] | None:
    from .schedules import DAYS, calendar_date, periods

    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {
        "mode",
        "timezone",
        "days",
        "dates",
        "periods",
    }:
        raise AccessError("invalid_user_timing")
    zone = value["timezone"]
    try:
        if not isinstance(zone, str) or len(zone) > 128:
            raise AccessError("invalid_user_timing")
        ZoneInfo(zone)
    except (ZoneInfoNotFoundError, ValueError):
        raise AccessError("invalid_user_timing") from None
    days, dates = value["days"], value["dates"]
    if not isinstance(days, list) or not isinstance(dates, list):
        raise AccessError("invalid_user_timing")
    if value["mode"] == "weekly":
        if dates or not 1 <= len(days) <= 7 or any(day not in DAYS for day in days):
            raise AccessError("invalid_user_timing")
        if len(set(days)) != len(days):
            raise AccessError("invalid_user_timing")
        days = [day for day in DAYS if day in days]
    elif value["mode"] == "dates":
        if days or not 1 <= len(dates) <= 64:
            raise AccessError("invalid_user_timing")
        dates = sorted(calendar_date(day).isoformat() for day in dates)
        if len(set(dates)) != len(dates):
            raise AccessError("invalid_user_timing")
    else:
        raise AccessError("invalid_user_timing")
    windows = periods(value["periods"])
    if not windows:
        raise AccessError("invalid_user_timing")
    return {
        "mode": value["mode"],
        "timezone": zone,
        "days": days,
        "dates": dates,
        "periods": windows,
    }
