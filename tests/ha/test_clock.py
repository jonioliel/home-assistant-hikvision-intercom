"""Actual HA options persistence, clock lifecycle, admin API and display metadata."""

import asyncio
from copy import deepcopy
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.data_entry_flow import FlowResultType

from custom_components.hikvision_intercom.clock import device_zone, parse_clock
from custom_components.hikvision_intercom.clock_runtime import StationClock
from custom_components.hikvision_intercom.exceptions import HikvisionValidationError

from .test_websocket import request

RULE = "CST-2:00:00DST01:00:00,M4.1.0/02:00:00,M10.5.0/02:00:00"
READ = parse_clock(
    {"Time": {"localTime": "2026-09-09T00:00:00+03:00", "timeZone": RULE, "timeMode": "NTP"}},
    datetime(2026, 9, 8, 21, tzinfo=UTC),
)


async def test_clock_get_and_overview_use_device_rules_by_default(
    hass, loaded_entry, hass_ws_client, device_io
):
    clock = loaded_entry.runtime_data.clock
    clock.client.async_read = AsyncMock(return_value=READ)
    client = await hass_ws_client(hass)
    result = await request(client, "stations/clock_refresh", station_id=loaded_entry.entry_id)
    assert result["success"] and result["result"]["source"] == "device"
    overview = (await request(client, "overview"))["result"]
    assert overview["stations"][0]["clock"]["zone"]["start"] == [4, 1, 0, 7200]
    assert overview["default_zone"]["name"] == hass.config.time_zone
    device_io["unlock"].assert_not_called()
    device_io["write_person"].assert_not_called()


async def test_manual_option_persists_and_invalid_zone_does_not_save(hass, loaded_entry):
    with patch.object(hass.config_entries, "async_reload", AsyncMock(return_value=True)):
        flow = await hass.config_entries.options.async_init(loaded_entry.entry_id)
        fields = {
            "idle_interval": 2,
            "active_interval": 0.75,
            "pulse_seconds": 5,
            "display_time_zone": "manual",
            "manual_time_zone": "Not/AZone",
        }
        result = await hass.config_entries.options.async_configure(flow["flow_id"], fields)
        assert result["errors"] == {"manual_time_zone": "invalid_time_zone"}
        assert not loaded_entry.options
        fields["manual_time_zone"] = "Asia/Jerusalem"
        result = await hass.config_entries.options.async_configure(flow["flow_id"], fields)
        assert result["type"] is FlowResultType.CREATE_ENTRY
        assert loaded_entry.options["manual_time_zone"] == "Asia/Jerusalem"
        await hass.async_block_till_done()


async def test_failed_read_falls_back_then_uses_stale_rules_without_losing_manual_zone(hass):
    clock = StationClock(hass, SimpleNamespace(), None)
    clock.client.async_read = AsyncMock(side_effect=HikvisionValidationError("PRIVATE"))
    try:
        await clock.async_refresh()
        assert clock.public()["source"] == "fallback" and clock.public()["zone"]["name"] == "UTC"
        clock.client.async_read = AsyncMock(return_value=READ)
        await clock.async_refresh()
        clock.client.async_read = AsyncMock(side_effect=HikvisionValidationError("PRIVATE"))
        await clock.async_refresh()
        assert clock.public()["status"] == "stale" and clock.public()["zone"] == device_zone(RULE)
        clock.manual = {"kind": "iana", "name": "Asia/Jerusalem"}
        assert (
            clock.public()["source"] == "manual"
            and clock.public()["zone"]["name"] == "Asia/Jerusalem"
        )
        assert "PRIVATE" not in str(clock.public())
    finally:
        await clock.async_close()


async def test_clock_reads_coalesce_and_unload_cancels_timer_and_pending_request(hass):
    entered, release = asyncio.Event(), asyncio.Event()

    async def read():
        entered.set()
        await release.wait()
        return deepcopy(READ)

    clock = StationClock(hass, SimpleNamespace(), None)
    clock.client.async_read = AsyncMock(side_effect=read)
    first = asyncio.create_task(clock.async_refresh())
    await entered.wait()
    second = asyncio.create_task(clock.async_refresh())
    await asyncio.sleep(0)
    assert clock.client.async_read.await_count == 1
    release.set()
    await asyncio.gather(first, second)
    assert clock._timer is not None
    release.clear()
    entered.clear()
    third = asyncio.create_task(clock.async_refresh())
    await entered.wait()
    await clock.async_close()
    with pytest.raises(asyncio.CancelledError):
        await third
    assert clock._timer is None and clock._task is None


async def test_explicit_clock_refresh_rejects_unloaded_station(hass, loaded_entry, hass_ws_client):
    client = await hass_ws_client(hass)
    await hass.config_entries.async_unload(loaded_entry.entry_id)
    result = await request(client, "stations/clock_refresh", station_id=loaded_entry.entry_id)
    assert result["error"]["code"] == "station_offline"


async def test_measured_clock_health_survives_display_override_and_failed_read_resets_trend(hass):
    from datetime import timedelta

    from custom_components.hikvision_intercom.clock_health import measured_clock

    instant = datetime(2026, 9, 8, 21, tzinfo=UTC)
    sample = measured_clock(
        {"Time": {"localTime": "2026-09-09T00:02:00+03:00", "timeZone": RULE, "timeMode": "NTP"}},
        instant,
        instant + timedelta(seconds=1),
        1,
    )
    clock = StationClock(hass, SimpleNamespace(), {"kind": "iana", "name": "UTC"})
    clock.client.async_read = AsyncMock(return_value=sample)
    try:
        with patch(
            "custom_components.hikvision_intercom.clock_runtime.monotonic", side_effect=[0, 300]
        ):
            await clock.async_refresh()
            assert clock.public()["drift_state"] == "ahead"
            await clock.async_refresh()
            value = clock.public()
            assert value["drift_state"] == "repeated_ahead"
            assert value["zone"]["name"] == "UTC"
            assert value["device_zone"]["name"] == RULE
            assert value["measurement"]["uncertainty_seconds"] == 1.5
            assert value["next_transition"]["at"] == "2026-10-24T23:00:00+00:00"
            value["measurement"]["uncertainty_seconds"] = 99
            assert clock.public()["measurement"]["uncertainty_seconds"] == 1.5
        clock.client.async_read = AsyncMock(side_effect=HikvisionValidationError("PRIVATE"))
        await clock.async_refresh()
        assert clock.public()["status"] == "stale"
        assert clock.public()["drift_state"] == "not_measured"
    finally:
        await clock.async_close()
    assert clock._timer is None
