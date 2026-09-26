"""Request uncertainty, configured DST rules and repeated drift qualification."""

from copy import deepcopy
from datetime import UTC, datetime, timedelta

import pytest
from test_clock import OBSERVED, RULE

from custom_components.hikvision_intercom.clock import device_zone, named_zone
from custom_components.hikvision_intercom.clock_health import (
    ClockTrend,
    measured_clock,
    next_transition,
)

NOW = datetime(2026, 9, 8, 21, 8, 10, tzinfo=UTC)


def test_request_midpoint_and_conservative_network_uncertainty():
    sample = measured_clock(OBSERVED, NOW, NOW + timedelta(seconds=4), 4)
    assert sample["measurement"] == {
        "status": "measured",
        "duration_seconds": 4,
        "estimated_skew_seconds": -2,
        "uncertainty_seconds": 3,
    }
    assert sample["checked_at"] == (NOW + timedelta(seconds=4)).isoformat()
    assert sample["skew_seconds"] == -4  # Preserve receive-time compatibility.
    assert sample["time_mode"] == "NTP"


@pytest.mark.parametrize("wall,elapsed", [(10, 1), (-1, 1), (1, float("inf")), (21, 21)])
def test_host_clock_jump_or_invalid_request_cannot_produce_precise_drift(wall, elapsed):
    sample = measured_clock(OBSERVED, NOW, NOW + timedelta(seconds=wall), elapsed)
    assert sample["measurement"]["status"] != "measured"
    assert sample["measurement"]["estimated_skew_seconds"] is None


@pytest.mark.parametrize(
    "now,at,before,after",
    [
        ("2026-03-01T00:00:00Z", "2026-04-05T00:00:00+00:00", 7200, 10800),
        ("2026-04-05T00:00:00Z", "2026-10-24T23:00:00+00:00", 10800, 7200),
        ("2026-12-31T23:59:59Z", "2027-04-04T00:00:00+00:00", 7200, 10800),
    ],
)
def test_next_transition_uses_device_rules_and_skips_current_boundary(now, at, before, after):
    assert next_transition(device_zone(RULE), datetime.fromisoformat(now)) == {
        "status": "scheduled",
        "at": at,
        "before_seconds": before,
        "after_seconds": after,
    }


def test_southern_half_hour_rules_fixed_zone_and_iana_unknown():
    zone = device_zone("CST-10:30:00DST00:30:00,M10.1.0/02:00:00,M4.1.0/02:00:00")
    assert next_transition(zone, datetime(2026, 1, 1, tzinfo=UTC)) == {
        "status": "scheduled",
        "at": "2026-04-04T15:00:00+00:00",
        "before_seconds": 39600,
        "after_seconds": 37800,
    }
    assert next_transition(device_zone("CST-5:30:00"), NOW) == {"status": "fixed"}
    assert next_transition(named_zone("UTC"), NOW) == {"status": "fixed"}
    assert next_transition(named_zone("Asia/Jerusalem"), NOW) == {"status": "not_computed"}


def sample(skew, uncertainty=1):
    result = measured_clock(OBSERVED, NOW, NOW, 0)
    result["measurement"].update(estimated_skew_seconds=skew, uncertainty_seconds=uncertainty)
    return result


def test_repeated_drift_requires_separated_same_direction_samples_and_resets_after_gap():
    trend = ClockTrend()
    trend.observe(sample(120), 0)
    assert trend.state == "ahead"
    trend.observe(sample(130), 299)
    assert trend.state == "ahead"
    trend.observe(sample(130), 300)
    assert trend.state == "repeated_ahead"
    trend.observe(sample(130), 301)
    assert trend.state == "repeated_ahead"
    trend.observe(sample(130), 3100)
    assert trend.state == "ahead"
    trend.observe(sample(-130), 3400)
    assert trend.state == "behind"
    trend.observe(sample(-135), 3700)
    assert trend.state == "repeated_behind"
    trend.reset()
    trend.observe(sample(-135), 4000)
    assert trend.state == "behind"


def test_uncertainty_missing_measurement_and_configuration_change_break_evidence():
    trend = ClockTrend()
    trend.observe(sample(120), 0)
    trend.observe(sample(95, 10), 300)
    assert trend.state == "uncertain"
    trend.observe(sample(120), 600)
    assert trend.state == "ahead"
    changed = deepcopy(sample(120))
    changed["time_mode"] = "manual"
    trend.observe(changed, 900)
    assert trend.state == "ahead"
    trend.observe(sample(0, 2), 1200)
    assert trend.state == "within_tolerance"
    trend.observe({}, 1500)
    assert trend.state == "not_measured"
