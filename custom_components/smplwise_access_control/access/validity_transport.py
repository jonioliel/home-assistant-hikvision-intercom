"""Recover only journal-proven UTC echoes; never reinterpret unknown station records."""

from collections.abc import Callable
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import Any

from ..client.access import AccessCapabilities, StationInventory
from ..client.clock import ClockClient
from ..clock import localize, resolve_device_local_time
from .models import AccessError
from .normalize import canonical


def owned_utc_echo(
    inventory: StationInventory,
    employee_no: str,
    caps: AccessCapabilities,
    fingerprint: Callable[[Any], str],
    allowed: set[str | None],
) -> StationInventory | None:
    raw = inventory.users.get(employee_no, {}).get("Valid", {})
    if raw.get("enable") is not True or raw.get("timeType") != "local":
        return None
    try:
        values = [datetime.fromisoformat(raw[k]) for k in ("beginTime", "endTime")]
        if any(v.tzinfo is None or v.utcoffset() != timedelta(0) for v in values):
            return None
        candidate = deepcopy(inventory)
        candidate.users[employee_no]["Valid"]["timeType"] = "UTC"
        if fingerprint(canonical(candidate, employee_no, caps)) not in allowed:
            return None
        return candidate
    except (KeyError, TypeError, ValueError):
        return None


async def local_validity(client: Any, validity: dict[str, Any]) -> dict[str, Any]:
    clock = await ClockClient(client).async_read()
    measurement = clock["measurement"]
    if measurement["status"] != "measured" or (
        abs(measurement["estimated_skew_seconds"]) + measurement["uncertainty_seconds"] > 10
    ):
        raise AccessError("schedule_station_clock_unverified")
    result = {"enable": validity["enable"], "timeType": "local"}
    for key in ("beginTime", "endTime"):
        instant = datetime.fromisoformat(validity[key]).astimezone(UTC)
        wall = localize(instant, clock["zone"]).replace(tzinfo=None)
        # Reject folds/gaps rather than grant an ambiguous repeated local hour.
        if resolve_device_local_time(wall.strftime("%Y-%m-%d %H:%M:%S"), clock["zone"]) != instant:
            raise AccessError("validity_timezone_mismatch")
        result[key] = wall.isoformat(timespec="seconds")
    return result
