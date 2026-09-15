"""Real HA registration and managed-door write boundary."""

from unittest.mock import AsyncMock, patch

from .test_websocket import request


async def test_technical_rejects_unmanaged_door(hass, loaded_entry, hass_ws_client):
    client = await hass_ws_client(hass)
    with patch(
        "custom_components.hikvision_intercom.technical_api.update_door", AsyncMock()
    ) as write:
        result = await request(
            client,
            "stations/technical_update",
            station_id=loaded_entry.entry_id,
            door=2,
            expected={},
            changes={"openDuration": 4},
            confirmed=True,
        )
    assert not result["success"]
    write.assert_not_called()


async def test_technical_requires_confirmation(hass, loaded_entry, hass_ws_client):
    client = await hass_ws_client(hass)
    with patch(
        "custom_components.hikvision_intercom.technical_api.update_door", AsyncMock()
    ) as write:
        result = await request(
            client,
            "stations/technical_update",
            station_id=loaded_entry.entry_id,
            door=1,
            expected={},
            changes={"openDuration": 4},
            confirmed=False,
        )
    assert not result["success"]
    write.assert_not_called()


async def test_hold_draft_save_does_not_write_station(
    hass, loaded_entry, hass_ws_client, device_io
):
    client = await hass_ws_client(hass)
    result = await request(
        client,
        "stations/technical_hold_save",
        station_id=loaded_entry.entry_id,
        door=1,
        revision=0,
        policy={
            "timezone": "Asia/Jerusalem",
            "schedule": {
                "name": "Cleaning",
                "weekly": {
                    day: []
                    for day in (
                        "Monday",
                        "Tuesday",
                        "Wednesday",
                        "Thursday",
                        "Friday",
                        "Saturday",
                        "Sunday",
                    )
                },
                "holidays": [],
            },
        },
    )
    assert result["success"] and result["result"]["active"] is False
    assert result["result"]["draft"]["revision"] == 1
    device_io["unlock"].assert_not_awaited()
