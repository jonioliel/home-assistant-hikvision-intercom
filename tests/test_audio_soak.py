"""CI smoke path for the separately runnable sustained loopback exercise."""

import asyncio

import pytest
from soak.run_audio import exercise


@pytest.mark.parametrize("stations", [1, 4, 12])
async def test_variable_fleet_audio_fault_does_not_block_pin_recovery_or_polling(stations):
    async with asyncio.timeout(120):
        report = await exercise(0, cycle_seconds=0.5, stations=stations, event_budget=16)
    assert report["sessions_opened"] == report["sessions_closed"] == min(stations, 3) * 2
    assert report["faults_observed"] == 1
    assert report["polls"] >= stations * 2
    assert report["writes"] == stations * 3
    assert report["max_receive_queue"] <= 3 and report["max_transmit_queue"] <= 3
    assert report["remaining_peer_tasks"] == 0
    assert report["slow_consumer_drops"] > 0
    assert report["events_ingested"] == report["event_duplicates_rejected"] > 0
    assert report["event_restart_replays_rejected"] > 0
    assert report["max_event_records"] <= 16


@pytest.mark.parametrize(
    "values",
    [
        {"stations": 0},
        {"stations": 129},
        {"media_budget": 0},
        {"poll_concurrency": 65},
        {"event_budget": 15},
    ],
)
async def test_resource_budget_is_checked_before_opening_any_socket(values):
    with pytest.raises(ValueError):
        await exercise(0, **values)
