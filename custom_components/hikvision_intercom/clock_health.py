"""Read-only clock estimates relative to HA and explicit device-rule forecasts."""

from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta
from typing import Any

from .clock import _transition, offset_at, parse_clock


def measured_clock(
    payload: dict[str, Any], started: datetime, received: datetime, elapsed: float
) -> dict[str, Any]:
    """Bound a fresh device timestamp within its request, allowing one-second precision.

    This is not an NTP measurement: server processing, asymmetric transport and
    timestamp quantization are included in the uncertainty. HA is the reference.
    A wall-clock jump during the request invalidates the estimate.
    """
    result = parse_clock(payload, received)
    wall_elapsed = (received - started).total_seconds()
    valid = (
        math.isfinite(elapsed)
        and 0 <= elapsed <= 20
        and wall_elapsed >= 0
        and abs(wall_elapsed - elapsed) <= 0.5
    )
    estimate = None
    uncertainty = None
    if valid:
        observed = datetime.fromisoformat(result["device_time"])
        estimate = round((observed - started).total_seconds() - wall_elapsed / 2, 3)
        uncertainty = math.ceil((max(elapsed, wall_elapsed) / 2 + 1) * 1000) / 1000
    result["measurement"] = {
        "status": "measured" if valid else "host_clock_changed",
        "duration_seconds": round(elapsed, 3) if math.isfinite(elapsed) and elapsed >= 0 else None,
        "estimated_skew_seconds": estimate,
        "uncertainty_seconds": uncertainty,
    }
    result["next_transition"] = next_transition(result["zone"], received)
    return result


def next_transition(zone: dict[str, Any], now: datetime) -> dict[str, Any]:
    """Forecast the next change from the device's explicit recurring M rules.

    IANA-only observations do not expose device recurrence rules, so do not
    substitute a guessed region or imply that there is no DST transition.
    """
    if zone["kind"] != "device":
        return {"status": "fixed" if zone["name"] == "UTC" else "not_computed"}
    if not zone["delta"]:
        return {"status": "fixed"}
    try:
        candidates = sorted(
            _transition(year, zone[rule], zone["standard"] + delta)
            for year in range(max(2, now.year - 1), min(9998, now.year + 2) + 1)
            for rule, delta in (("start", 0), ("end", zone["delta"]))
        )
        for instant in candidates:
            if instant <= now.astimezone(UTC):
                continue
            before = offset_at(instant - timedelta(seconds=1), zone)
            after = offset_at(instant, zone)
            if before != after:
                return {
                    "status": "scheduled",
                    "at": instant.isoformat(),
                    "before_seconds": before,
                    "after_seconds": after,
                }
    except (ValueError, OverflowError):
        pass
    return {"status": "not_computed"}


class ClockTrend:
    """Require two separate same-direction observations, not rapid refresh clicks."""

    def __init__(self) -> None:
        self.baseline: tuple[str, float, str] | None = None
        self.state = "not_measured"

    def reset(self) -> None:
        self.baseline = None
        self.state = "not_measured"

    def observe(self, sample: dict[str, Any], monotonic_now: float) -> None:
        measurement = sample.get("measurement") or {}
        skew = measurement.get("estimated_skew_seconds")
        uncertainty = measurement.get("uncertainty_seconds")
        if measurement.get("status") != "measured" or skew is None or uncertainty is None:
            self.reset()
            return
        lower, upper = skew - uncertainty, skew + uncertainty
        direction = "ahead" if lower > 90 else "behind" if upper < -90 else None
        if direction is None:
            self.reset()
            self.state = "within_tolerance" if lower >= -90 and upper <= 90 else "uncertain"
            return
        basis = str((sample["zone"], sample.get("time_mode")))
        baseline = self.baseline
        if (
            baseline is None
            or baseline[0] != direction
            or baseline[2] != basis
            or not 0 <= monotonic_now - baseline[1] <= 2700
        ):
            self.baseline = (direction, monotonic_now, basis)
            self.state = direction
        elif monotonic_now - baseline[1] >= 300:
            self.state = "repeated_" + direction
            self.baseline = (direction, monotonic_now, basis)
