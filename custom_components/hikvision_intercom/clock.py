"""Explicit station display zones; UTC instants never receive a second source offset.

Hikvision timeZone syntax follows manufacturer pages 42-43/300: the standard
sign is reversed, DST is an increment, and Mmonth.week.weekday uses Sunday=0.
Current configured rules are not a history of past station configuration changes.
"""

from __future__ import annotations

import calendar
import re
from datetime import UTC, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .exceptions import HikvisionValidationError

UTC_ZONE: dict[str, Any] = {"kind": "iana", "name": "UTC"}


def named_zone(value: Any) -> dict[str, Any]:
    if (
        not isinstance(value, str)
        or not 1 <= len(value) <= 128
        or not re.fullmatch(r"[A-Za-z0-9_+./-]+", value)
    ):
        raise HikvisionValidationError("Invalid display time zone")
    if value == "UTC":
        return dict(UTC_ZONE)
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise HikvisionValidationError("Unknown display time zone") from None
    return {"kind": "iana", "name": value}


def _duration(value: str, *, maximum: int) -> int:
    parts = [int(p) for p in value.split(":")]
    if len(parts) != 3 or parts[1] > 59 or parts[2] > 59:
        raise HikvisionValidationError("Invalid clock offset")
    seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
    if seconds > maximum:
        raise HikvisionValidationError("Clock offset exceeds limits")
    return seconds


def _rule(value: str) -> list[int]:
    match = re.fullmatch(r"M([1-9]|1[0-2])\.([1-5])\.([0-6])/([0-9]{1,2}:[0-9]{2}:[0-9]{2})", value)
    if not match:
        raise HikvisionValidationError("Unsupported device daylight saving rule")
    return [int(match[1]), int(match[2]), int(match[3]), _duration(match[4], maximum=86399)]


def device_zone(value: Any) -> dict[str, Any]:
    if not isinstance(value, str) or len(value) > 256:
        raise HikvisionValidationError("Missing device time zone")
    match = re.fullmatch(
        r"([A-Za-z]{3,16})([+-])([0-9]{1,2}:[0-9]{2}:[0-9]{2})(?:DST([0-9]{1,2}:[0-9]{2}:[0-9]{2}),([^,]+),([^,]+))?",
        value,
    )
    if not match:
        raise HikvisionValidationError("Unsupported device time zone")
    standard = _duration(match[3], maximum=14 * 3600) * (-1 if match[2] == "+" else 1)
    delta = _duration(match[4], maximum=3 * 3600) if match[4] else 0
    if abs(standard + delta) > 14 * 3600 or match[4] and not delta:
        raise HikvisionValidationError("Invalid daylight saving increment")
    start, end = _rule(match[5]) if match[5] else None, _rule(match[6]) if match[6] else None
    if start is not None and start == end:
        raise HikvisionValidationError("Identical daylight saving transitions")
    return {
        "kind": "device",
        "name": value,
        "standard": standard,
        "delta": delta,
        "start": start,
        "end": end,
    }


def _transition(year: int, rule: list[int], offset: int) -> datetime:
    month, week, weekday, second = rule
    first, count = calendar.monthrange(year, month)
    day = 1 + (weekday - (first + 1) % 7) % 7 + (week - 1) * 7
    if day > count:
        day -= 7
    return datetime(year, month, day, tzinfo=UTC) + timedelta(seconds=second - offset)


def offset_at(when: datetime, zone: dict[str, Any]) -> int:
    if when.tzinfo is None:
        raise HikvisionValidationError("Clock conversion requires an absolute instant")
    when = when.astimezone(UTC)
    if zone["kind"] == "iana":
        if zone["name"] == "UTC":
            return 0
        offset = when.astimezone(ZoneInfo(zone["name"])).utcoffset()
        assert offset is not None
        return int(offset.total_seconds())
    base, delta = int(zone["standard"]), int(zone["delta"])
    if delta:
        for year in range(max(1, when.year - 1), min(9998, when.year + 1) + 1):
            start = _transition(year, zone["start"], base)
            end = _transition(year, zone["end"], base + delta)
            if end <= start:
                end = _transition(year + 1, zone["end"], base + delta)
            if start <= when < end:
                return base + delta
    return base


def localize(when: datetime, zone: dict[str, Any]) -> datetime:
    if when.tzinfo is None:
        raise HikvisionValidationError("Clock conversion requires an absolute instant")
    return when.astimezone(timezone(timedelta(seconds=offset_at(when, zone))))


def parse_clock(payload: dict[str, Any], now: datetime) -> dict[str, Any]:
    root = payload.get("Time")
    if not isinstance(root, dict):
        raise HikvisionValidationError("Missing device clock")
    zone = device_zone(root["timeZone"]) if root.get("timeZone") else named_zone(root.get("IANA"))
    raw = root.get("localTime")
    if not isinstance(raw, str) or len(raw) > 40:
        raise HikvisionValidationError("Missing device local time")
    try:
        observed = datetime.fromisoformat(raw)
    except ValueError:
        raise HikvisionValidationError("Invalid device local time") from None
    if observed.tzinfo is None or observed.utcoffset() != localize(observed, zone).utcoffset():
        raise HikvisionValidationError("Device local offset contradicts configured time zone")
    mode = root.get("timeMode")
    return {
        "zone": zone,
        "device_time": observed.isoformat(),
        "checked_at": now.isoformat(),
        "skew_seconds": round((observed - now).total_seconds()),
        "time_mode": mode
        if isinstance(mode, str)
        and mode in {"NTP", "manual", "satellite", "platform", "NONE", "GB28181"}
        else "unknown",
    }


def resolve_device_local_time(value: str, zone: dict[str, Any]) -> datetime:
    """Resolve the observed offset-free history format, rejecting DST folds and gaps."""
    if not isinstance(value, str) or not re.fullmatch(
        r"[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}", value
    ):
        raise HikvisionValidationError("Unsupported device-local history time")
    try:
        wall = datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        raise HikvisionValidationError("Invalid device-local history time") from None
    nominal = wall.replace(tzinfo=UTC)
    offsets = {offset_at(nominal + timedelta(days=days), zone) for days in (-2, -1, 0, 1, 2)}
    candidates = {
        candidate
        for offset in offsets
        if localize(candidate := nominal - timedelta(seconds=offset), zone).replace(tzinfo=None)
        == wall
    }
    if len(candidates) != 1:
        raise HikvisionValidationError("Ambiguous or nonexistent device-local history time")
    return next(iter(candidates))
