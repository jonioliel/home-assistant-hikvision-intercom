"""Exercise the real Home Assistant WebSocket transport and authorization."""

import json
import logging

import pytest

from custom_components.hikvision_intercom.access_runtime import get_manager
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.websocket import COMMANDS


async def request(client, command, **data):
    await client.send_json_auto_id({"type": f"{DOMAIN}/{command}", **data})
    return await client.receive_json()


async def test_admin_overview_and_panel_registration(hass, loaded_entry, hass_ws_client):
    client = await hass_ws_client(hass)
    result = await request(client, "overview")
    assert result["success"]
    station = result["result"]["stations"][0]
    assert set(station["entities"]) == {"camera", "lock", "call_status", "online", "ringing"}
    assert "password" not in json.dumps(result) and "demo-secret" not in json.dumps(result)
    assert hass.data[DOMAIN]["panel_registered"]
    from homeassistant.components.frontend import DATA_PANELS

    assert hass.data[DATA_PANELS]["hikvision-intercom"].require_admin


@pytest.mark.parametrize("command", [*COMMANDS, "subscribe"])
async def test_all_administrative_commands_reject_reader(
    hass, loaded_entry, hass_ws_client, hass_read_only_access_token, command
):
    client = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    result = await request(client, command)
    assert not result["success"] and result["error"]["code"] == "unauthorized"


async def test_create_get_update_card_and_delete_never_echo_secrets(
    hass, loaded_entry, hass_ws_client
):
    client = await hass_ws_client(hass)
    result = await request(
        client,
        "users/create",
        data={
            "display_name": "Resident",
            "pin": "847291",
            "cards": [{"card_no": "000077779999", "label": "Primary"}],
        },
    )
    assert result["success"]
    user = result["result"]
    assert user["pin_configured"] and user["cards"][0]["masked_number"] == "•••• 9999"
    assert "847291" not in json.dumps(result) and "000077779999" not in json.dumps(result)
    result = await request(client, "users/get", user_id=user["id"])
    assert result["success"] and "847291" not in json.dumps(result)
    result = await request(
        client, "users/update", user_id=user["id"], revision=1, data={"display_name": "Latest"}
    )
    assert result["result"]["revision"] == 2
    result = await request(
        client, "cards/remove", user_id=user["id"], revision=2, card_id=user["cards"][0]["id"]
    )
    assert result["result"]["cards"] == []
    result = await request(client, "users/delete", user_id=user["id"], revision=3)
    assert result["success"] and not get_manager(hass).repository.users()


async def test_invalid_secret_payload_never_appears_in_error_or_debug_log(
    hass, loaded_entry, hass_ws_client, caplog
):
    caplog.set_level(logging.DEBUG, logger="homeassistant.components.websocket_api.http.connection")
    client = await hass_ws_client(hass)
    result = await request(
        client,
        "users/create",
        data={
            "display_name": "Resident",
            "pin": "PRIVATE_INVALID_PIN",
            "cards": [{"card_no": "PRIVATE-CARD-98765432"}],
        },
    )
    assert not result["success"]
    assert "PRIVATE_INVALID_PIN" not in json.dumps(result) + caplog.text
    assert "PRIVATE-CARD-98765432" not in json.dumps(result) + caplog.text
    assert not get_manager(hass).repository.users()
    result = await request(client, "users/create", data="PRIVATE_SCHEMA_ERROR")
    assert result["error"]["code"] == "invalid_fields"
    assert "PRIVATE_SCHEMA_ERROR" not in json.dumps(result) + caplog.text


async def test_stale_revision_and_disabled_lock_never_mutate(
    hass, loaded_entry, hass_ws_client, device_io
):
    client = await hass_ws_client(hass)
    created = await request(client, "users/create", data={"display_name": "Resident"})
    user_id = created["result"]["id"]
    result = await request(
        client, "users/update", user_id=user_id, revision=9, data={"display_name": "Wrong"}
    )
    assert not result["success"] and result["error"]["code"] == "revision_conflict"
    result = await request(client, "stations/test_unlock", station_id=loaded_entry.entry_id, lock=2)
    assert not result["success"]
    device_io["unlock"].assert_not_called()


async def test_successful_release_uses_runtime_guard(hass, loaded_entry, hass_ws_client, device_io):
    client = await hass_ws_client(hass)
    result = await request(client, "stations/test_unlock", station_id=loaded_entry.entry_id, lock=1)
    assert result["success"]
    device_io["unlock"].assert_awaited_once_with(1)


async def test_subscription_is_data_free_and_cleans_up(hass, loaded_entry, hass_ws_client):
    from homeassistant.helpers.dispatcher import async_dispatcher_send

    from custom_components.hikvision_intercom.access_runtime import SIGNAL_ACCESS_CHANGED

    client = await hass_ws_client(hass)
    result = await request(client, "subscribe")
    subscription = result["id"]
    assert result["success"]
    async_dispatcher_send(hass, SIGNAL_ACCESS_CHANGED)
    event = await client.receive_json()
    assert event["event"] == {"kind": "refresh"}
    await client.send_json_auto_id({"type": "unsubscribe_events", "subscription": subscription})
    assert (await client.receive_json())["success"]


async def test_sync_diagnostics_export_is_admin_only_and_contains_no_record_data(
    hass,
    loaded_entry,
    hass_ws_client,
):
    manager = get_manager(hass)
    user = await manager.async_create(
        {"display_name": "PRIVATE PERSON", "pin": "847291", "cards": [{"card_no": "000077779999"}]}
    )
    manager.diagnostics.stage(loaded_entry.entry_id, user["id"], "create_person")
    from custom_components.hikvision_intercom.exceptions import HikvisionDeviceError

    manager.diagnostics.finish(
        loaded_entry.entry_id, user["id"], error=HikvisionDeviceError("SECRET BODY 847291")
    )
    client = await hass_ws_client(hass)
    response = await request(client, "sync/diagnostics")
    assert response["success"]
    text = json.dumps(response["result"])
    for secret in (
        "847291",
        "000077779999",
        "PRIVATE PERSON",
        "SECRET BODY",
        loaded_entry.entry_id,
        loaded_entry.data["host"],
    ):
        assert secret not in text
    assert response["result"]["recent"][-1]["step"] == "create_person"
