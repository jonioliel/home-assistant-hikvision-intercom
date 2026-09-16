"""NTP control uses the real administrator websocket boundary."""

from unittest.mock import AsyncMock, patch

import pytest

from custom_components.hikvision_intercom.const import DOMAIN

from .test_websocket import request


async def test_clock_settings_save_and_stale_request(hass, loaded_entry, hass_ws_client):
    ws = await hass_ws_client(hass)
    current = (await request(ws, "clock/settings_get"))["result"]
    assert current["server"] == "time.windows.com"
    saved = await request(
        ws,
        "clock/settings_update",
        revision=0,
        values={"server": "time.google.com", "port": 123, "interval": 60},
    )
    assert saved["success"] and saved["result"]["revision"] == 1
    with patch("custom_components.hikvision_intercom.clock_api.synchronize", AsyncMock()) as sync:
        rejected = await request(
            ws, "clock/station_sync", station_id=loaded_entry.entry_id, revision=0, copy_system=True
        )
    assert rejected["error"]["code"] == "revision_conflict"
    sync.assert_not_called()


async def test_clock_station_dispatch(hass, loaded_entry, hass_ws_client):
    ws = await hass_ws_client(hass)
    with patch(
        "custom_components.hikvision_intercom.clock_api.synchronize",
        AsyncMock(return_value={"configuration_verified": True, "clock_verified": False}),
    ) as sync:
        result = await request(
            ws,
            "clock/station_sync",
            station_id=loaded_entry.entry_id,
            revision=0,
            copy_system=False,
        )
    assert result["success"] and not result["result"]["clock_verified"]
    assert sync.call_args.kwargs == {"copy_system": False}
    assert not hass.data[DOMAIN]["clock_writes"]


@pytest.mark.parametrize("supported", [False, True])
async def test_host_ntp_feature_gate_and_readback(hass, loaded_entry, hass_ws_client, supported):
    ws = await hass_ws_client(hass)
    config = {"servers": ["time.windows.com"], "fallback_servers": []}
    responses = [{"features": ["ntp"] if supported else []}, {}, {"config": config}]
    with patch(
        "custom_components.hikvision_intercom.clock_api.supervisor",
        AsyncMock(side_effect=responses),
    ) as api:
        result = await request(ws, "clock/host_apply", revision=0)
    assert result["success"] is supported
    assert api.await_count == (3 if supported else 1)
