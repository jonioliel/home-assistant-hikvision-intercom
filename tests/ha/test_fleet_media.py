"""Nine real HA runtimes with simulated device I/O; not physical fleet acceptance."""

import asyncio
from dataclasses import replace
from datetime import UTC, datetime
from unittest.mock import patch

from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.event_manager import get_events
from custom_components.hikvision_intercom.health_api import dispatch_health
from custom_components.hikvision_intercom.websocket import overview

from .conftest import DATA, PROFILE
from .test_events import live


async def test_nine_ha_stations_keep_events_calls_and_unload_independent(hass, device_io):
    async def profile(client):
        return replace(
            PROFILE, unique_id=client._expected_identity, serial=client._expected_identity
        )

    async def info(client):
        return (
            client._expected_identity,
            PROFILE.model,
            PROFILE.firmware,
            client._expected_identity,
        )

    entered = asyncio.Event()
    cancelled = asyncio.Event()

    async def signal(client, command):
        if client.client._expected_identity == "FLEET-0":
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        return {
            "command": command,
            "acknowledged": True,
            "physical_result": "unverified",
            "observed_state": "idle",
            "observation": "state_changed",
        }

    entries = []
    pending = None
    with (
        patch(
            "custom_components.hikvision_intercom.client.client.HikvisionClient.async_profile",
            profile,
        ),
        patch(
            "custom_components.hikvision_intercom.client.client.HikvisionClient.async_device_info",
            info,
        ),
        patch("custom_components.hikvision_intercom.health_api.MediaClient.signal", signal),
    ):
        try:
            for index in range(9):
                entry = MockConfigEntry(
                    domain=DOMAIN,
                    title=f"Station {index}",
                    unique_id=f"FLEET-{index}",
                    data={**DATA, "host": f"192.0.2.{index + 1}"},
                )
                entry.add_to_hass(hass)
                assert await hass.config_entries.async_setup(entry.entry_id)
                entries.append(entry)
            await hass.async_block_till_done()
            for entry in entries:
                entry.runtime_data.events.trace.start("idle")
            for cycle in range(25):
                for index, entry in enumerate(entries):
                    entry.runtime_data.events.ingest(
                        live(
                            181,
                            serialNo=cycle * 10 + index,
                            name=f"Resident {index}",
                            employeeNoString=f"EMP{index}",
                        )
                    )
            latest = get_events(hass).cache.latest_access(
                {entry.entry_id for entry in entries}, datetime.now(UTC)
            )
            assert len(latest) == 9
            for index, entry in enumerate(entries):
                assert latest[entry.entry_id]["employee_no"] == f"EMP{index}"
                assert len(entry.runtime_data.events.trace.public()["capture"]["records"]) <= 300
            pending = asyncio.create_task(
                dispatch_health(
                    hass, "media/signal", {"station_id": entries[0].entry_id, "command": "reject"}
                )
            )
            await entered.wait()
            result = await dispatch_health(
                hass, "media/signal", {"station_id": entries[1].entry_id, "command": "reject"}
            )
            assert result["acknowledged"]
            entries[2].runtime_data.coordinator.last_update_success = False
            snapshot = overview(hass)
            assert sum(station["online"] for station in snapshot["stations"]) == 8
            assert await hass.config_entries.async_unload(entries[0].entry_id)
            await asyncio.gather(pending, return_exceptions=True)
            assert cancelled.is_set()
            assert len(get_events(hass).stations) == 8
            assert not hass.data[DOMAIN]["call_commands_busy"]
            device_io["unlock"].assert_not_called()
        finally:
            if pending and not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)
            for entry in reversed(entries):
                if entry.entry_id in get_events(hass).stations:
                    await hass.config_entries.async_unload(entry.entry_id)
            await hass.async_block_till_done()
