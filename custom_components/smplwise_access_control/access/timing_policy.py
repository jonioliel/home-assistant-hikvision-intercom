"""Explicit enforcement policies and finite UTC windows, never a permanent fallback."""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from .models import AccessError
from .user_timing import timing_draft


def policy(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {"mode", "schedule", "bindings"}:
        raise AccessError("invalid_timing_policy")
    if value["mode"] not in ("ha", "native"):
        raise AccessError("invalid_timing_policy")
    schedule = timing_draft(value["schedule"])
    if schedule is None or not isinstance(value["bindings"], dict):
        raise AccessError("invalid_timing_policy")
    bindings = {}
    if value["mode"] == "ha" and value["bindings"]:
        raise AccessError("invalid_timing_policy")
    if len(value["bindings"]) > 100:
        raise AccessError("invalid_timing_policy")
    from .schedule_compiler import bindings_for
    from .user_timing_plan import user_schedule

    for station, slots in value["bindings"].items():
        if not isinstance(station, str) or not 1 <= len(station) <= 64:
            raise AccessError("invalid_timing_policy")
        bindings[station] = bindings_for(slots, len(user_schedule(schedule)["holidays"]))
        if any(i > 65532 for i in [bindings[station]["template"], bindings[station]["weekly"]]):
            raise AccessError("schedule_binding_invalid")
    return {"mode": value["mode"], "schedule": schedule, "bindings": bindings}


def boundary(day: date, clock: str, zone: ZoneInfo) -> datetime:
    if clock == "24:00":
        day, clock = day + timedelta(days=1), "00:00"
    wall = datetime.combine(day, time.fromisoformat(clock))
    candidates = {
        local.astimezone(UTC)
        for fold in (0, 1)
        if (local := wall.replace(tzinfo=zone, fold=fold))
        .astimezone(UTC)
        .astimezone(zone)
        .replace(tzinfo=None)
        == wall
    }
    # Never widen a permission by guessing which occurrence of an ambiguous time.
    if len(candidates) != 1:
        raise AccessError("timing_boundary_ambiguous")
    return candidates.pop()


def rolling_validity(
    schedule: dict[str, Any],
    *,
    now: datetime | None = None,
    valid_from: str | None = None,
    valid_until: str | None = None,
) -> dict[str, Any]:
    """Current or next single allowed interval; HA absence cannot extend its end.

    Keep a current interval until it expires. Install the next one while outside;
    device Valid itself denies the gap, including when HA is stopped or offline.
    Invalid DST windows are skipped (denied), never shifted or expanded.
    """
    from .schedules import DAYS

    now = now or datetime.now(UTC)
    if now.tzinfo is None:
        raise AccessError("invalid_validity")
    zone = ZoneInfo(schedule["timezone"])
    today = now.astimezone(zone).date()
    dates = (
        [
            today + timedelta(days=n)
            for n in range(15)
            if DAYS[(today + timedelta(days=n)).weekday()] in schedule["days"]
        ]
        if schedule["mode"] == "weekly"
        else [date.fromisoformat(d) for d in schedule["dates"]]
    )
    lower = datetime.fromisoformat(valid_from) if valid_from else datetime(2000, 1, 1, tzinfo=UTC)
    upper = (
        datetime.fromisoformat(valid_until)
        if valid_until
        else datetime(2037, 12, 31, 23, 59, 59, tzinfo=UTC)
    )
    # An expired, finite interval is a denied state, not enable=False (permanent).
    result = {
        "enable": True,
        "beginTime": "2000-01-01T00:00:00+00:00",
        "endTime": "2000-01-01T00:01:00+00:00",
        "timeType": "UTC",
    }
    windows = []
    for day in dates:
        if day < today or day.year > 2037:
            continue
        for period in schedule["periods"]:
            try:
                start = max(boundary(day, period["start"], zone), lower)
                end = min(boundary(day, period["end"], zone), upper)
            except AccessError:
                continue
            if start < end and end > now:
                windows.append((start, end))
    if windows:
        start, end = min(windows)
        result.update(
            beginTime=start.isoformat(timespec="seconds"), endTime=end.isoformat(timespec="seconds")
        )
    return result


def renewal_delay(
    users: Any, station: str, maximum: float = 300, bindings: dict[str, Any] | None = None
) -> float:
    now = datetime.now(UTC)
    delay = maximum
    for user in users:
        timing = user.access_timing_policy
        assignment = user.assignments.get(station)
        if not (
            timing and timing["mode"] == "ha" and user.active and assignment and assignment.enabled
        ):
            continue
        window = rolling_validity(
            timing["schedule"], now=now, valid_from=user.valid_from, valid_until=user.valid_until
        )
        end = datetime.fromisoformat(window["endTime"])
        if end > now:
            installed = (bindings or {}).get(user.id, {}).get("timing_readback")
            if (
                installed
                and installed["mode"] == "ha"
                and installed["revision"] == user.revision
                and assignment.sync_state == "synced"
                and installed["valid_until"]
            ):
                # Work may cross the installed boundary. Computing only the next
                # desired expiry here would postpone renewal for another 5 minutes.
                end = min(end, datetime.fromisoformat(installed["valid_until"]))
            delay = min(delay, max(1, (end - now).total_seconds() + 0.1))
    return delay
