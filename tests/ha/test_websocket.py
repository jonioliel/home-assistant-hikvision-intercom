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


async def test_overview_retains_actual_contact_time_through_failed_polls(
    hass, loaded_entry, hass_ws_client, device_io
):
    from unittest.mock import patch

    from custom_components.hikvision_intercom.client.client import CallState
    from custom_components.hikvision_intercom.exceptions import HikvisionConnectionError

    coordinator = loaded_entry.runtime_data.coordinator
    device_io["call"].return_value = CallState("unknown", "new_state")
    with patch(
        "custom_components.hikvision_intercom.coordinator.monotonic", side_effect=[10, 10.025]
    ):
        await coordinator.async_refresh()
    seen = coordinator.last_seen.isoformat()
    assert coordinator.last_poll_ms == 25.0
    device_io["call"].side_effect = HikvisionConnectionError("PRIVATE HOST")
    await coordinator.async_refresh()
    client = await hass_ws_client(hass)
    result = await request(client, "overview")
    station = result["result"]["stations"][0]
    assert not station["online"] and station["call_state"] == "unavailable"
    assert station["last_seen"] == seen and station["last_poll_ms"] == 25.0
    assert station["pending_user_count"] == 0
    assert station["last_access"] is None
    assert "PRIVATE HOST" not in json.dumps(result)
    device_io["call"].side_effect = None
    await coordinator.async_refresh()
    result = await request(client, "stations/get", station_id=loaded_entry.entry_id)
    assert result["result"]["online"]
    assert result["result"]["last_seen"] >= seen


async def test_overview_exposes_only_safe_latest_access_without_triggering_recovered_events(
    hass, loaded_entry, hass_ws_client
):
    from datetime import UTC, datetime
    from unittest.mock import patch

    from custom_components.hikvision_intercom.event_manager import get_events
    from custom_components.hikvision_intercom.events import normalize_event

    now = datetime.now(UTC)
    event = normalize_event(
        {
            "major": 5,
            "minor": 214,
            "time": now.isoformat(),
            "name": "Guest",
            "cardNo": "000011112222",
            "localPassword": "918273",
            "unlockType": "card",
        },
        loaded_entry.entry_id,
        b"x" * 32,
        received=now,
        selected_api=1,
        historical=True,
    )
    with patch("custom_components.hikvision_intercom.event_manager.async_dispatcher_send") as send:
        get_events(hass).accept(event)
        client = await hass_ws_client(hass)
        result = await request(client, "overview")
        # Accepting/querying a historical record never emits the live event signal.
        from custom_components.hikvision_intercom.event_manager import SIGNAL_EVENT

        assert not any(call.args[1] == SIGNAL_EVENT for call in send.call_args_list)
    access = result["result"]["stations"][0]["last_access"]
    assert access["result"] == "unknown" and access["event_type"] == "unlock_record"
    assert access["person_name"] == "Guest" and access["recovered"]
    for secret in ("000011112222", "918273", "localPassword"):
        assert secret not in json.dumps(result)
    assert "card" not in access


@pytest.mark.parametrize("channel", ["websocket", "service"])
async def test_rescan_entry_points_do_not_initiate_queued_writes(
    hass, loaded_entry, hass_ws_client, device_io, channel
):
    manager = get_manager(hass)
    await hass.async_block_till_done()
    await manager.repository.async_create(
        {
            "display_name": "Waiting person",
            "pin": "918273",
            "assignments": {loaded_entry.entry_id: {"allowed_locks": [1]}},
        }
    )
    before = manager.repository.snapshot()
    reconciled = manager.stations[loaded_entry.entry_id].reconciled_at
    if channel == "websocket":
        client = await hass_ws_client(hass)
        response = await request(client, "stations/rescan", station_id=loaded_entry.entry_id)
        assert response["success"]
    else:
        await hass.services.async_call(
            DOMAIN,
            "rescan_station",
            {
                "station_id": loaded_entry.entry_id,
            },
            blocking=True,
        )
    await hass.async_block_till_done()
    assert manager.repository.snapshot() == before
    assert manager.stations[loaded_entry.entry_id].reconciled_at == reconciled
    assert manager.stations[loaded_entry.entry_id].task is None
    device_io["write_person"].assert_not_called()
    device_io["unlock"].assert_not_called()
    # Access rescan does not silently reload/change the configured core profile.
    device_io["profile"].assert_awaited_once()


async def test_inspection_capabilities_exclude_secrets_and_unselected_relays(
    hass, loaded_entry, hass_ws_client
):
    client = await hass_ws_client(hass)
    response = await request(client, "stations/get", station_id=loaded_entry.entry_id)
    station = response["result"]
    assert station["integrated_locks"] == [{"physical_index": 1, "api_id": 1}]
    assert station["observations"] == {
        "call_status": True,
        "snapshot": True,
        "video_channel": True,
        "user_info": True,
        "card_info": True,
        "event_query": False,
    }
    assert station["event_status"]["stream"] == "connecting"
    assert not station["scanning"] and station["scan_error"] is None
    assert "demo-secret" not in json.dumps(response)
    hass.config_entries.async_update_entry(loaded_entry, data={**loaded_entry.data, "locks": []})
    await hass.async_block_till_done()
    response = await request(client, "stations/get", station_id=loaded_entry.entry_id)
    assert response["result"]["integrated_locks"] == []
    assert not response["result"]["lock_enabled"]


async def test_unexpected_inspection_failure_never_reaches_ha_background_logs(
    hass, loaded_entry, hass_ws_client, caplog
):
    from unittest.mock import AsyncMock, patch

    client = await hass_ws_client(hass)
    with patch(
        "custom_components.hikvision_intercom.client.access.AccessClient.async_inventory",
        AsyncMock(side_effect=RuntimeError("PRIVATE-INSPECTION-CREDENTIAL")),
    ):
        response = await request(client, "stations/rescan", station_id=loaded_entry.entry_id)
        await hass.async_block_till_done()
    assert response["error"]["code"] == "storage_or_internal_error"
    assert "PRIVATE-INSPECTION-CREDENTIAL" not in caplog.text + json.dumps(response)


async def test_unloaded_station_keeps_configured_lock_mapping_without_online_controls(
    hass, loaded_entry, hass_ws_client
):
    assert await hass.config_entries.async_unload(loaded_entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)
    response = await request(client, "stations/get", station_id=loaded_entry.entry_id)
    station = response["result"]
    assert not station["online"] and not station["loaded"]
    assert station["capabilities"] is None
    assert not station["observations"]["user_info"]
    assert station["integrated_locks"] == [{"physical_index": 1, "api_id": 1}]


async def test_save_mode_is_validated_and_only_immediate_mode_requests_work(
    hass, loaded_entry, hass_ws_client
):
    from unittest.mock import patch

    manager = get_manager(hass)
    client = await hass_ws_client(hass)
    with patch.object(manager, "request_user") as queued:
        created = await request(
            client, "users/create", data={"display_name": "Saved"}, sync_now=False
        )
        assert created["success"]
        queued.assert_not_called()
        user = created["result"]
        updated = await request(
            client,
            "users/update",
            user_id=user["id"],
            revision=user["revision"],
            data={"display_name": "Saved again"},
            sync_now=False,
        )
        assert updated["success"]
        queued.assert_not_called()
        immediate = await request(
            client,
            "users/update",
            user_id=user["id"],
            revision=updated["result"]["revision"],
            data={"display_name": "Sync now"},
            sync_now=True,
        )
        assert immediate["success"]
        queued.assert_called_once_with(user["id"])
        queued.reset_mock()
        legacy = await request(client, "users/create", data={"display_name": "Existing client"})
        assert legacy["success"]
        queued.assert_called_once_with(legacy["result"]["id"])
        invalid = await request(
            client, "users/create", data={"display_name": "Invalid"}, sync_now="false"
        )
        assert invalid["error"]["code"] == "invalid_fields"
        assert len(manager.repository.users()) == 2


async def test_configured_lock_name_is_in_admin_projection_only_for_selected_lock(
    hass, loaded_entry, hass_ws_client
):
    client = await hass_ws_client(hass)
    mapping = {**loaded_entry.data["locks"][0], "name": "Garden door"}
    hass.config_entries.async_update_entry(
        loaded_entry, data={**loaded_entry.data, "locks": [mapping]}
    )
    await hass.async_block_till_done()
    response = await request(client, "overview")
    assert response["result"]["stations"][0]["integrated_locks"] == [
        {"physical_index": 1, "api_id": 1, "name": "Garden door"}
    ]
    hass.config_entries.async_update_entry(loaded_entry, data={**loaded_entry.data, "locks": []})
    await hass.async_block_till_done()
    response = await request(client, "overview")
    assert response["result"]["stations"][0]["integrated_locks"] == []


async def test_release_failure_has_safe_specific_outcome_without_retry(
    hass, loaded_entry, hass_ws_client, device_io, caplog
):
    from custom_components.hikvision_intercom.exceptions import HikvisionConnectionError

    device_io["unlock"].side_effect = HikvisionConnectionError("PRIVATE_DEVICE_RELEASE_DETAIL")
    client = await hass_ws_client(hass)
    result = await request(client, "stations/test_unlock", station_id=loaded_entry.entry_id, lock=1)
    assert result["error"]["code"] == "release_unconfirmed"
    assert "PRIVATE_DEVICE_RELEASE_DETAIL" not in json.dumps(result) + caplog.text
    device_io["unlock"].assert_awaited_once_with(1)
    assert not loaded_entry.runtime_data.released
    assert not loaded_entry.runtime_data.unlocking


async def test_parallel_release_targets_are_independent_and_same_target_is_guarded(
    hass, loaded_entry, hass_ws_client, device_io
):
    import asyncio
    from dataclasses import replace
    from unittest.mock import AsyncMock, patch

    from pytest_homeassistant_custom_component.common import MockConfigEntry

    from custom_components.hikvision_intercom.exceptions import HikvisionConnectionError

    from .conftest import DATA, PROFILE

    second_profile = replace(PROFILE, unique_id="SECOND-DEMO", serial="SECOND-DEMO")
    device_io["profile"].return_value = second_profile
    second = MockConfigEntry(
        domain=DOMAIN,
        title="Second",
        unique_id=second_profile.unique_id,
        data={**DATA, "name": "Second", "host": "192.0.2.11"},
    )
    second.add_to_hass(hass)
    with patch(
        "custom_components.hikvision_intercom.client.client.HikvisionClient.async_device_info",
        AsyncMock(
            return_value=(
                second_profile.unique_id,
                second_profile.model,
                second_profile.firmware,
                second_profile.serial,
            )
        ),
    ):
        assert await hass.config_entries.async_setup(second.entry_id)
        await hass.async_block_till_done()
    started, finish = asyncio.Event(), asyncio.Event()

    async def delayed_release(_lock):
        started.set()
        await finish.wait()
        raise HikvisionConnectionError("private first station")

    first_ws = await hass_ws_client(hass)
    other_ws = await hass_ws_client(hass)
    try:
        with (
            patch.object(
                loaded_entry.runtime_data.client, "async_unlock", side_effect=delayed_release
            ) as first_call,
            patch.object(second.runtime_data.client, "async_unlock", AsyncMock()) as second_call,
        ):
            await first_ws.send_json_auto_id(
                {
                    "type": f"{DOMAIN}/stations/test_unlock",
                    "station_id": loaded_entry.entry_id,
                    "lock": 1,
                }
            )
            await asyncio.wait_for(started.wait(), 5)
            duplicate = await request(
                other_ws, "stations/test_unlock", station_id=loaded_entry.entry_id, lock=1
            )
            assert duplicate["error"]["code"] == "release_in_progress"
            result = await request(
                other_ws, "stations/test_unlock", station_id=second.entry_id, lock=1
            )
            assert result["success"]
            assert loaded_entry.runtime_data.unlocking and second.runtime_data.released
            assert not second.runtime_data.unlocking
            first_call.assert_awaited_once_with(1)
            second_call.assert_awaited_once_with(1)
            finish.set()
            result = await first_ws.receive_json()
            assert result["error"]["code"] == "release_unconfirmed"
            assert not loaded_entry.runtime_data.released
            assert second.runtime_data.released
    finally:
        finish.set()
        await hass.async_block_till_done()
        await hass.config_entries.async_unload(second.entry_id)
        await hass.async_block_till_done()


@pytest.mark.parametrize(
    "domain,key", [(DOMAIN, "PRIVATE_UNKNOWN_KEY"), ("other", "release_unconfirmed")]
)
async def test_unknown_ha_release_errors_do_not_expose_exception_details(
    hass, loaded_entry, hass_ws_client, domain, key
):
    from unittest.mock import patch

    from homeassistant.exceptions import HomeAssistantError

    client = await hass_ws_client(hass)
    with patch.object(
        type(loaded_entry.runtime_data),
        "async_unlock",
        side_effect=HomeAssistantError(
            "PRIVATE_ERROR_MESSAGE", translation_domain=domain, translation_key=key
        ),
    ):
        result = await request(
            client, "stations/test_unlock", station_id=loaded_entry.entry_id, lock=1
        )
    assert result["error"]["code"] == "action_failed"
    assert "PRIVATE" not in json.dumps(result)


@pytest.mark.parametrize("direction", ["central", "device"])
async def test_review_transport_is_private_and_stale_resolution_preserves_user(
    hass, loaded_entry, hass_ws_client, device_io, monkeypatch, direction
):
    from copy import deepcopy
    from unittest.mock import AsyncMock

    from custom_components.hikvision_intercom.access.normalize import (
        canonical,
        desired_cards,
        desired_person,
    )
    from custom_components.hikvision_intercom.client.access import StationInventory

    manager = get_manager(hass)
    station_id = loaded_entry.entry_id
    driver = manager.stations[station_id].driver
    user = await manager.repository.async_create(
        {
            "display_name": "Central resident",
            "pin": "847291",
            "cards": [{"card_no": "000077779999"}],
            "assignments": {station_id: {"allowed_locks": [1]}},
        }
    )
    inventory = StationInventory(
        {user.employee_no: desired_person(user, 1, driver.capabilities)},
        desired_cards(user, driver.capabilities),
    )
    await manager.repository.async_bind(
        station_id,
        user.id,
        fingerprint=manager.repository.fingerprint(
            canonical(inventory, user.employee_no, driver.capabilities)
        ),
    )
    observed = deepcopy(inventory)
    observed.users[user.employee_no].update(name="Device resident", localPassword="735281")
    reader = AsyncMock(return_value=observed)
    monkeypatch.setattr(driver, "async_person", reader)
    before = manager.repository.snapshot()
    client = await hass_ws_client(hass)
    response = await request(client, "conflicts/review", station_id=station_id, user_id=user.id)
    assert response["success"]
    review = response["result"]
    assert review["revision"] == 1 and review["differences"] == ["display_name", "pin"]
    assert review["actions"][direction]["allowed"]
    assert review["affected_stations"] == [station_id]
    for secret in ("847291", "735281", "000077779999", "fingerprint_key"):
        assert secret not in json.dumps(response)
    assert manager.repository.snapshot() == before
    device_io["write_person"].assert_not_called()
    device_io["unlock"].assert_not_called()
    await manager.repository.async_update(
        user.id, {"display_name": "Concurrent edit"}, expected_revision=1
    )
    reader.reset_mock()
    response = await request(
        client,
        "conflicts/resolve",
        station_id=station_id,
        user_id=user.id,
        revision=review["revision"],
        review_token=review["review_token"],
        direction=direction,
    )
    assert response["error"]["code"] == "revision_conflict"
    assert manager.repository.get(user.id).display_name == "Concurrent edit"
    reader.assert_not_called()
    device_io["write_person"].assert_not_called()
