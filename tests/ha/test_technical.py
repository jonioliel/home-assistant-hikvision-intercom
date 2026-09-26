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


async def test_hold_program_inactive_roundtrip_and_removal(hass, loaded_entry, hass_ws_client):
    from tests.test_hold_open import sample

    client = await hass_ws_client(hass)
    prefix = "stations/technical_program_"
    with patch(
        "custom_components.hikvision_intercom.client.technical.verify_hold_support",
        AsyncMock(),
    ) as probe:
        result = await request(
            client,
            prefix + "save",
            station_id=loaded_entry.entry_id,
            door=1,
            revision=0,
            policy=sample(),
            enabled=False,
        )
        assert result["success"], result
        assert result["result"]["programs"][0]["enabled"] is False
        probe.assert_not_awaited()
    listed = await request(client, prefix + "list", station_id=loaded_entry.entry_id)
    assert listed["success"] and len(listed["result"]["programs"]) == 1
    assert "identity" not in listed["result"]["programs"][0]
    removed = await request(
        client,
        prefix + "action",
        station_id=loaded_entry.entry_id,
        door=1,
        revision=1,
        action="remove",
    )
    assert removed["success"] and removed["result"]["programs"] == []


async def test_hold_program_activation_is_capability_gated(hass, loaded_entry, hass_ws_client):
    from custom_components.hikvision_intercom.access.models import AccessError
    from tests.test_hold_open import sample

    client = await hass_ws_client(hass)
    with patch(
        "custom_components.hikvision_intercom.client.technical.verify_hold_support",
        AsyncMock(side_effect=AccessError("operation_unsupported")),
    ):
        result = await request(
            client,
            "stations/technical_program_save",
            station_id=loaded_entry.entry_id,
            door=1,
            revision=0,
            policy=sample(),
            enabled=True,
        )
    assert not result["success"]
    assert hass.data["hikvision_intercom"]["hold_programs"].listing(loaded_entry.entry_id) == []


async def test_hold_program_runtime_uses_bound_station_and_restores(
    hass, loaded_entry, hass_ws_client
):
    from datetime import UTC, datetime

    from tests.test_hold_open import sample

    client = await hass_ws_client(hass)
    with patch(
        "custom_components.hikvision_intercom.client.technical.verify_hold_support",
        AsyncMock(),
    ):
        result = await request(
            client,
            "stations/technical_program_save",
            station_id=loaded_entry.entry_id,
            door=1,
            revision=0,
            policy=sample(),
            enabled=True,
        )
    assert result["success"], result
    manager = hass.data["hikvision_intercom"]["hold_programs"]
    with patch(
        "custom_components.hikvision_intercom.access_runtime.hold_command", AsyncMock()
    ) as send:
        await manager.tick(datetime(2026, 9, 14, 10, tzinfo=UTC))
        send.assert_awaited_once_with(
            loaded_entry.runtime_data.client, 1, "alwaysOpen", commissioned=True
        )
        await manager.action(loaded_entry.entry_id, 1, 1, "pause")
        assert send.await_args.args[2] == "close"
    assert manager.listing(loaded_entry.entry_id)[0]["execution"]["owned"] is False


async def test_public_code_write_routes_transient_secret_to_guarded_client(
    hass, loaded_entry, hass_ws_client
):
    client = await hass_ws_client(hass)
    with patch(
        "custom_components.hikvision_intercom.client.public_codes.mutate",
        AsyncMock(return_value={"acknowledged": True, "physical_verified": False}),
    ) as write:
        result = await request(
            client,
            "stations/technical_codes_write",
            station_id=loaded_entry.entry_id,
            slot=1,
            action="add",
            door=1,
            expected=False,
            old_pin="",
            new_pin="654321",
            compatibility=False,
            confirmed=True,
        )
    assert result["success"]
    assert "654321" not in str(result)
    assert write.await_args.args[0] is loaded_entry.runtime_data.client
    assert write.await_args.args[1]["new_pin"] == "654321"


async def test_public_code_read_routes_to_current_station(hass, loaded_entry, hass_ws_client):
    client = await hass_ws_client(hass)
    with patch(
        "custom_components.hikvision_intercom.client.public_codes.inspect",
        AsyncMock(return_value={"status": {"states": {"public1Configured": False}}}),
    ) as read:
        result = await request(
            client, "stations/technical_codes_get", station_id=loaded_entry.entry_id
        )
    assert result["success"]
    read.assert_awaited_once_with(loaded_entry.runtime_data.client)
