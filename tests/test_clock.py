"""Real clock rule, DST boundaries, no double offset and read-only transport."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from test_client import SETTINGS
from test_events import normalized, payload

from custom_components.hikvision_intercom.client.client import HikvisionClient
from custom_components.hikvision_intercom.client.clock import ClockClient
from custom_components.hikvision_intercom.clock import (
    device_zone,
    localize,
    named_zone,
    parse_clock,
    resolve_device_local_time,
)
from custom_components.hikvision_intercom.exceptions import HikvisionValidationError
from custom_components.hikvision_intercom.reporting import build_report

RULE = "CST-2:00:00DST01:00:00,M4.1.0/02:00:00,M10.5.0/02:00:00"
OBSERVED = json.loads((Path(__file__).parent / "fixtures/device_clock_readonly.json").read_text())


@pytest.mark.parametrize(
    "instant,expected",
    [
        ("2026-01-01T00:00:00Z", "2026-01-01T02:00:00+02:00"),
        ("2026-09-08T21:08:10Z", "2026-09-09T00:08:10+03:00"),
        ("2026-09-09T00:08:10+03:00", "2026-09-09T00:08:10+03:00"),
        ("2026-04-04T23:59:59Z", "2026-04-05T01:59:59+02:00"),
        ("2026-04-05T00:00:00Z", "2026-04-05T03:00:00+03:00"),
        ("2026-10-24T22:59:59Z", "2026-10-25T01:59:59+03:00"),
        ("2026-10-24T23:00:00Z", "2026-10-25T01:00:00+02:00"),
    ],
)
def test_observed_rules_at_dst_boundaries(instant, expected):
    assert localize(datetime.fromisoformat(instant), device_zone(RULE)).isoformat() == expected


def test_real_clock_payload_is_consistent_without_guessing_iana_name():
    result = parse_clock(OBSERVED, datetime(2026, 9, 8, 21, 8, 10, tzinfo=UTC))
    assert result["device_time"] == "2026-09-09T00:08:10+03:00"
    assert result["skew_seconds"] == 0 and result["zone"]["name"] == RULE
    assert result["zone"]["start"] == [4, 1, 0, 7200]


@pytest.mark.parametrize(
    "rule",
    [
        None,
        {},
        "Asia/Jerusalem",
        "CST-2",
        "CST-15:00:00",
        "CST-2:60:00",
        "CST-2:00:00DST01:00:00",
        "CST-2:00:00DST01:00:00,M4.6.0/02:00:00,M10.5.0/02:00:00",
        "CST-2:00:00DST01:00:00,M4.1.0/24:00:00,M10.5.0/02:00:00",
        "CST-2:00:00DST00:00:00,M4.1.0/02:00:00,M10.5.0/02:00:00",
        "CST-2:00:00DST01:00:00,M4.1.0/02:00:00,M4.1.0/02:00:00",
    ],
)
def test_unsupported_clock_rules_are_not_guessed(rule):
    with pytest.raises(HikvisionValidationError):
        device_zone(rule)


def test_fractional_offset_and_southern_hemisphere_wrap():
    fixed = device_zone("CST-5:30:00")
    assert localize(datetime(2026, 1, 1, tzinfo=UTC), fixed).utcoffset() == timedelta(
        hours=5, minutes=30
    )
    southern = device_zone("CST-10:30:00DST00:30:00,M10.1.0/02:00:00,M4.1.0/02:00:00")
    assert localize(datetime(2026, 1, 1, tzinfo=UTC), southern).utcoffset() == timedelta(hours=11)
    assert localize(datetime(2026, 7, 1, tzinfo=UTC), southern).utcoffset() == timedelta(
        hours=10, minutes=30
    )
    west = device_zone("CST+3:30:00")
    assert localize(datetime(2026, 1, 1, tzinfo=UTC), west).utcoffset() == -timedelta(
        hours=3, minutes=30
    )


def test_manual_iana_keeps_its_own_dst_rules():
    instant = datetime(2026, 3, 28, 12, tzinfo=UTC)
    assert localize(instant, named_zone("Asia/Jerusalem")).utcoffset() == timedelta(hours=3)
    assert localize(instant, device_zone(RULE)).utcoffset() == timedelta(hours=2)
    with pytest.raises(HikvisionValidationError):
        named_zone("Not/AZone")
    with pytest.raises(HikvisionValidationError):
        named_zone("../zone")


@pytest.mark.parametrize(
    "value", ["2026-09-09T00:08:10", "2026-09-09T00:08:10+00:00", "not-a-date"]
)
def test_conflicting_or_naive_device_clock_requires_manual_or_explicit_fallback(value):
    with pytest.raises(HikvisionValidationError):
        parse_clock({"Time": {**OBSERVED["Time"], "localTime": value}}, datetime.now(UTC))


async def test_clock_transport_only_gets_documented_time_endpoint():
    calls = []

    def handler(request):
        calls.append((request.method, request.url.path))
        return httpx.Response(200, json=OBSERVED)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        result = await ClockClient(HikvisionClient(session, SETTINGS)).async_read()
    assert result["zone"]["delta"] == 3600 and calls == [("GET", "/ISAPI/System/time")]


def test_report_days_and_export_follow_each_station_without_altering_utc_timestamp():
    row = normalized(payload(181))
    row["timestamp"] = "2026-09-08T21:30:00+00:00"
    row["station_id"] = "a"
    result = build_report([row], datetime.now(UTC), {"a": "Demo"}, True, {"a": device_zone(RULE)})
    assert result["by_day"][0]["day"] == "2026-09-09" and result["day_timezone"] == "station"
    assert "2026-09-09T00:30:00+03:00" in result["csv"]
    assert "2026-09-08T21:30:00+00:00" in result["csv"]
    assert row["timestamp"] == "2026-09-08T21:30:00+00:00"


@pytest.mark.parametrize(
    "wall,expected",
    [
        ("2026-09-09 11:34:59", "2026-09-09T08:34:59+00:00"),
        ("2026-01-01 11:34:59", "2026-01-01T09:34:59+00:00"),
    ],
)
def test_verified_local_history_uses_rules_for_event_date(wall, expected):
    assert resolve_device_local_time(wall, device_zone(RULE)).isoformat() == expected


@pytest.mark.parametrize(
    "wall",
    [
        "2026-04-05 02:30:00",
        "2026-10-25 01:30:00",
        "2026-02-30 12:00:00",
        "2026-09-09T12:00:00Z",
        "not a time",
    ],
)
def test_local_history_rejects_dst_gaps_folds_and_unsupported_formats(wall):
    with pytest.raises(HikvisionValidationError):
        resolve_device_local_time(wall, device_zone(RULE))
