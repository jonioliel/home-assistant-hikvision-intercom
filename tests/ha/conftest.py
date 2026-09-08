"""Tests use real HA 2026.9; only device I/O is mocked."""

import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.config_entries import ConfigEntryState
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.hikvision_intercom.client.access import AccessCapabilities, StationInventory
from custom_components.hikvision_intercom.client.client import CallState, StationProfile
from custom_components.hikvision_intercom.const import DOMAIN

DATA = {
    "name": "Front",
    "host": "192.0.2.10",
    "username": "demo",
    "password": "demo-secret",
    "scheme": "http",
    "port": 80,
    "verify_ssl": True,
    "rtsp_port": 554,
    "locks": [{"physical_index": 1, "api_id": 1, "confirmed": True}],
}
PROFILE = StationProfile(
    "DEMO-SERIAL",
    "DS-KV6124-E1",
    "V3.9.0",
    "DEMO-SERIAL",
    (1, 2),
    ("idle", "ring", "onCall"),
    True,
    True,
)


@pytest.fixture(autouse=True)
def custom_integrations(enable_custom_integrations):
    yield


@pytest.fixture(autouse=True)
def isolated_access_storage(hass, tmp_path):
    hass.config.config_dir = str(tmp_path)


@pytest.fixture
def device_io():
    fixtures = Path(__file__).parents[1] / "fixtures/ds_kv6124_e1_fw_3_9_0"
    caps = AccessCapabilities.from_payloads(
        json.loads((fixtures / "user_capabilities.json").read_text())["payload"],
        json.loads((fixtures / "card_capabilities.json").read_text())["payload"],
        {"pwMgrMode": "local"},
    )

    async def access_caps(driver):
        driver.capabilities = caps
        return caps

    with (
        patch("custom_components.hikvision_intercom.event_manager.StationEvents.start"),
        patch(
            "custom_components.hikvision_intercom.client.access.AccessClient.async_capabilities",
            access_caps,
        ),
        patch(
            "custom_components.hikvision_intercom.client.access.AccessClient.async_inventory",
            AsyncMock(return_value=StationInventory()),
        ) as inventory,
        patch(
            "custom_components.hikvision_intercom.client.access.AccessClient.async_write_person",
            AsyncMock(),
        ) as write_person,
        patch(
            "custom_components.hikvision_intercom.client.clock.ClockClient.async_read",
            AsyncMock(
                return_value={
                    "zone": {"kind": "iana", "name": "UTC"},
                    "device_time": "2026-09-09T00:00:00+00:00",
                    "checked_at": "2026-09-09T00:00:00+00:00",
                    "skew_seconds": 0,
                    "time_mode": "NTP",
                }
            ),
        ),
        patch(
            "custom_components.hikvision_intercom.client.client.HikvisionClient.async_profile",
            AsyncMock(return_value=PROFILE),
        ) as profile,
        patch(
            "custom_components.hikvision_intercom.client.client.HikvisionClient.async_call_status",
            AsyncMock(return_value=CallState("idle", "idle")),
        ) as call,
        patch(
            "custom_components.hikvision_intercom.client.client.HikvisionClient.async_device_info",
            AsyncMock(
                return_value=(PROFILE.unique_id, PROFILE.model, PROFILE.firmware, PROFILE.serial)
            ),
        ),
        patch(
            "custom_components.hikvision_intercom.client.client.HikvisionClient.async_unlock",
            AsyncMock(),
        ) as unlock,
        patch(
            "custom_components.hikvision_intercom.client.client.HikvisionClient.async_snapshot",
            AsyncMock(return_value=b"\xff\xd8image\xff\xd9"),
        ),
    ):
        yield {
            "profile": profile,
            "call": call,
            "unlock": unlock,
            "inventory": inventory,
            "write_person": write_person,
        }


@pytest.fixture
async def loaded_entry(hass, device_io):
    entry = MockConfigEntry(domain=DOMAIN, title="Front", unique_id=PROFILE.unique_id, data=DATA)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED
    yield entry
    if entry.state is ConfigEntryState.LOADED:
        await hass.config_entries.async_unload(entry.entry_id)
        await hass.async_block_till_done()
