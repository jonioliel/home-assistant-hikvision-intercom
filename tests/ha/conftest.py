"""Tests use real HA 2026.9; only device I/O is mocked."""

from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.config_entries import ConfigEntryState
from pytest_homeassistant_custom_component.common import MockConfigEntry

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


@pytest.fixture
def device_io():
    with (
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
        yield {"profile": profile, "call": call, "unlock": unlock}


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
