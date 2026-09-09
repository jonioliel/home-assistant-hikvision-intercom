"""Evidence boundaries, privacy, retention and complete-record tie selection."""

import copy
import json
from datetime import timedelta
from unittest.mock import AsyncMock, patch

import pytest
from test_events import NOW, normalized, payload

from custom_components.hikvision_intercom.client.schedule_readiness import inspect_readiness
from custom_components.hikvision_intercom.event_diagnostics import (
    EventTelemetry,
    event_support,
    explain_event,
)
from custom_components.hikvision_intercom.events import EventCache


@pytest.mark.parametrize(
    ("change", "origin"),
    [
        ({"source": "query"}, "history_query"),
        ({"source": "call_status"}, "call_poll"),
        ({"time_source": "received"}, "device_time_missing"),
        ({"timestamp": (NOW + timedelta(seconds=10)).isoformat()}, "device_time_ahead"),
        ({"timestamp": (NOW - timedelta(seconds=100)).isoformat()}, "delayed_stream"),
        ({"recovered": True}, "device_not_current"),
        ({}, "live_stream"),
    ],
)
def test_origin_is_explained_without_clock_inference(change, origin):
    row = {**normalized(), **change}
    assert explain_event(row)["origin"] == origin
    assert "evidence" not in row


def test_diagnostics_export_omits_all_identity_and_credentials():
    row = normalized(
        payload(
            name="Private Resident",
            employeeNoString="44321",
            cardNo="0000897122",
            password="secret",
        )
    )
    report = event_support(row, "demo")
    encoded = json.dumps(report)
    for secret in ("Private Resident", "44321", "0000897122", "secret", '"station_id"', '"record"'):
        assert secret not in encoded
    assert report["evidence"]["identity_state"] == "identified"


def test_telemetry_deduplicates_and_excludes_history_latency_and_bounds_samples():
    monitor = EventTelemetry()
    row = normalized()
    for _ in range(130):
        monitor.observe(row, True)
    monitor.observe(row, False)
    monitor.observe({**row, "source": "query", "recovered": True}, True)
    result = monitor.public()
    assert result["seen"] == 132 and result["accepted"] == 131 and result["duplicates"] == 1
    assert result["stream_arrival_delay"]["samples"] == 100
    assert result["origins"]["history_query"] == 1


def test_latest_access_tie_uses_whole_identified_event_without_merging():
    cache = EventCache()
    anonymous = normalized(payload(181))
    identified = normalized(
        {
            "major": 5,
            "minor": 181,
            "name": "Resident",
            "employeeNoString": "42",
            "time": NOW.isoformat(),
        },
        historical=True,
    )
    cache.add(anonymous, NOW)
    cache.add(identified, NOW)
    latest = cache.latest_access({"station"}, NOW)["station"]
    assert latest["person_name"] == "Resident" and latest["recovered"] is True
    assert latest["authentication"] == "pin"
    newer = normalized(payload(181, serialNo=13))
    newer["timestamp"] = (NOW + timedelta(seconds=1)).isoformat()
    cache.add(newer, NOW + timedelta(seconds=1))
    assert (
        cache.latest_access({"station"}, NOW + timedelta(seconds=1))["station"]["person_name"]
        is None
    )


@pytest.mark.parametrize(
    ("state", "count", "expected"),
    [
        ("complete", 0, "readable"),
        ("complete", 255, "readable"),
        ("partial", 300, "readable"),
        ("partial", 0, "failed"),
        ("unsupported", 0, "unsupported"),
        ("not_checked", 0, "not_checked"),
    ],
)
async def test_readiness_search_coverage_never_enables_writes(state, count, expected):
    inventory = {
        "checked_at": NOW.isoformat(),
        "checks": [
            {
                "kind": "holiday",
                "state": state,
                "read": count,
                "total": 1024,
                "error": None,
                "capabilities": None,
            }
        ],
    }
    with patch(
        "custom_components.hikvision_intercom.client.schedule_readiness.inspect_inventory",
        new=AsyncMock(return_value=copy.deepcopy(inventory)),
    ) as read:
        result = await inspect_readiness(object())
    assert read.await_count == 1
    assert result["read_method"] == "search" and result["can_apply"] is False
    assert result["checks"][0]["read_state"] == expected
    assert result["checks"][0]["coverage"] == state
