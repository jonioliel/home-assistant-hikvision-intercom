"""Real platform setup, services, states and cleanup."""

import asyncio
from dataclasses import replace
from datetime import timedelta

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_fire_time_changed

from custom_components.hikvision_intercom.client.client import CallState
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.diagnostics import async_get_config_entry_diagnostics
from custom_components.hikvision_intercom.exceptions import HikvisionConnectionError

from .conftest import DATA, PROFILE


def entity_id(hass, domain, key):
    return er.async_get(hass).async_get_entity_id(domain, DOMAIN, f"DEMO-SERIAL_{key}")


async def test_entities_states_and_diagnostics(hass, loaded_entry):
    registry = er.async_get(hass)
    entities = er.async_entries_for_config_entry(registry, loaded_entry.entry_id)
    assert len(entities) == 7
    assert {item.domain for item in entities} == {
        "binary_sensor",
        "sensor",
        "camera",
        "lock",
        "event",
    }
    assert not any("door_2" in item.unique_id for item in entities)
    assert hass.states.get(entity_id(hass, "sensor", "call_status")).state == "idle"
    assert hass.states.get(entity_id(hass, "binary_sensor", "online")).state == "on"
    assert (
        hass.states.get(entity_id(hass, "lock", "door_1")).attributes["state_source"]
        == "optimistic"
    )
    diagnostics = await async_get_config_entry_diagnostics(hass, loaded_entry)
    states = str([hass.states.get(item.entity_id).as_dict() for item in entities])
    for secret in (DATA["host"], DATA["password"], PROFILE.unique_id):
        assert secret not in str(diagnostics)
        assert secret not in states


async def test_unknown_and_offline_not_reported_idle(hass, loaded_entry, device_io):
    coordinator = loaded_entry.runtime_data.coordinator
    device_io["call"].return_value = CallState("unknown", "newFirmwareState")
    await coordinator.async_refresh()
    await hass.async_block_till_done()
    state = hass.states.get(entity_id(hass, "sensor", "call_status"))
    assert state.state == "unknown" and state.attributes["raw_state"] == "newFirmwareState"
    device_io["call"].side_effect = HikvisionConnectionError("offline")
    await coordinator.async_refresh()
    await hass.async_block_till_done()
    assert hass.states.get(entity_id(hass, "binary_sensor", "online")).state == "off"
    assert hass.states.get(entity_id(hass, "sensor", "call_status")).state == "unavailable"
    assert coordinator.update_interval.total_seconds() >= 4
    device_io["call"].side_effect = None
    device_io["call"].return_value = CallState("ringing", "ring")
    await coordinator.async_refresh()
    await hass.async_block_till_done()
    assert hass.states.get(entity_id(hass, "binary_sensor", "ringing")).state == "on"
    assert coordinator.update_interval.total_seconds() < 1
    assert coordinator.failures == 0


async def test_lock_service_display_timer_and_rejected_lock(hass, loaded_entry, device_io):
    lock_id = entity_id(hass, "lock", "door_1")
    await hass.services.async_call("lock", "unlock", {"entity_id": lock_id}, blocking=True)
    device_io["unlock"].assert_awaited_once_with(1)
    assert hass.states.get(lock_id).state == "unlocked"
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=6))
    await hass.async_block_till_done()
    assert hass.states.get(lock_id).state == "locked"
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call("lock", "lock", {"entity_id": lock_id}, blocking=True)
    device_io["unlock"].assert_awaited_once()


async def test_custom_service_and_unselected_rejection(hass, loaded_entry, device_io):
    device_id = er.async_get(hass).async_get(entity_id(hass, "lock", "door_1")).device_id
    await hass.services.async_call(
        DOMAIN, "unlock_door", {"device_id": device_id, "lock": 1}, blocking=True
    )
    device_io["unlock"].assert_awaited_once_with(1)
    import voluptuous as vol

    with pytest.raises(vol.Invalid):
        await hass.services.async_call(
            DOMAIN, "unlock_door", {"device_id": device_id, "lock": 2}, blocking=True
        )
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(DOMAIN, "unlock_door", {"lock": 1}, blocking=True)
    device_io["unlock"].assert_awaited_once()


async def test_release_failure_does_not_show_success(hass, loaded_entry, device_io):
    device_io["unlock"].side_effect = HikvisionConnectionError("private device URL")
    lock_id = entity_id(hass, "lock", "door_1")
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call("lock", "unlock", {"entity_id": lock_id}, blocking=True)
    assert hass.states.get(lock_id).state == "locked"
    assert loaded_entry.runtime_data._cancel_pulse is None


async def test_unload_cancels_poll_and_pulse_and_closes_session(hass, loaded_entry):
    runtime = loaded_entry.runtime_data
    await runtime.async_unlock(1)
    assert runtime._cancel_pulse is not None
    assert await hass.config_entries.async_unload(loaded_entry.entry_id)
    await hass.async_block_till_done()
    assert runtime.session.is_closed
    assert runtime._cancel_pulse is None
    assert hass.services.has_service(DOMAIN, "unlock_door")
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(DOMAIN, "unlock_door", {"lock": 1}, blocking=True)


async def test_camera_only_removes_stale_lock_on_reload(hass, loaded_entry, device_io):
    old_runtime = loaded_entry.runtime_data
    old_lock = entity_id(hass, "lock", "door_1")
    hass.config_entries.async_update_entry(loaded_entry, data={**DATA, "locks": []})
    await hass.async_block_till_done()
    assert old_runtime.session.is_closed
    assert er.async_get(hass).async_get(old_lock) is None
    assert not loaded_entry.runtime_data.locks
    with pytest.raises(ServiceValidationError):
        await loaded_entry.runtime_data.async_unlock(1)
    device_io["unlock"].assert_not_called()


async def test_identity_change_fails_setup_without_writes(hass, device_io):
    device_io["profile"].return_value = replace(PROFILE, unique_id="DIFFERENT")
    entry = MockConfigEntry(domain=DOMAIN, unique_id=PROFILE.unique_id, data=DATA)
    entry.add_to_hass(hass)
    assert not await hass.config_entries.async_setup(entry.entry_id)
    assert entry.state is ConfigEntryState.SETUP_ERROR
    device_io["unlock"].assert_not_called()


async def test_camera_image_and_backend_source(hass, loaded_entry):
    from custom_components.hikvision_intercom.camera import IntercomCamera

    camera = IntercomCamera(loaded_entry)
    assert await camera.async_camera_image() == b"\xff\xd8image\xff\xd9"
    assert (await camera.stream_source()).startswith("rtsp://demo:demo-secret@")
    assert "demo-secret" not in str(camera.extra_state_attributes)


async def test_admin_action_rejects_non_admin(hass, loaded_entry, device_io):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, patch

    from homeassistant.core import Context
    from homeassistant.exceptions import Unauthorized

    with patch.object(
        hass.auth, "async_get_user", AsyncMock(return_value=SimpleNamespace(is_admin=False))
    ):
        with pytest.raises(Unauthorized):
            await hass.services.async_call(
                DOMAIN,
                "unlock_door",
                {"entity_id": entity_id(hass, "lock", "door_1"), "lock": 1},
                blocking=True,
                context=Context(user_id="non-admin"),
            )
    device_io["unlock"].assert_not_called()


@pytest.mark.parametrize("lock", [2, 65535, True, False, 1.5, "all"])
async def test_service_invalid_lock_never_reaches_device(hass, loaded_entry, device_io, lock):
    import voluptuous as vol

    with pytest.raises(vol.Invalid):
        await hass.services.async_call(
            DOMAIN,
            "unlock_door",
            {"entity_id": entity_id(hass, "lock", "door_1"), "lock": lock},
            blocking=True,
        )
    device_io["unlock"].assert_not_called()


async def test_setup_failure_closes_owned_session(hass, device_io):
    from unittest.mock import patch

    from custom_components.hikvision_intercom.client.client import create_session

    sessions = []

    def capture(settings):
        session = create_session(settings)
        sessions.append(session)
        return session

    device_io["profile"].return_value = replace(PROFILE, unique_id="DIFFERENT")
    entry = MockConfigEntry(domain=DOMAIN, unique_id=PROFILE.unique_id, data=DATA)
    entry.add_to_hass(hass)
    with patch("custom_components.hikvision_intercom.runtime.create_session", capture):
        assert not await hass.config_entries.async_setup(entry.entry_id)
    assert len(sessions) == 1 and sessions[0].is_closed


async def test_camera_optional_failure(hass, loaded_entry, device_io):
    from unittest.mock import AsyncMock, patch

    from custom_components.hikvision_intercom.camera import IntercomCamera

    camera = IntercomCamera(loaded_entry)
    with patch.object(
        loaded_entry.runtime_data.client,
        "async_snapshot",
        AsyncMock(side_effect=HikvisionConnectionError("offline")),
    ):
        assert await camera.async_camera_image() is None
    loaded_entry.runtime_data.profile = replace(PROFILE, stream=False, snapshot=False)
    assert await camera.stream_source() is None
    assert await camera.async_camera_image() is None


async def test_home_assistant_stop_closes_session(hass, loaded_entry):
    from homeassistant.const import EVENT_HOMEASSISTANT_STOP

    runtime = loaded_entry.runtime_data
    hass.bus.async_fire(EVENT_HOMEASSISTANT_STOP)
    await hass.async_block_till_done()
    assert runtime.session.is_closed
    with pytest.raises(ServiceValidationError):
        await runtime.async_unlock(1)


async def test_lock_rename_updates_name_without_changing_entity_id_or_unlocking(
    hass, loaded_entry, device_io
):
    lock_id = entity_id(hass, "lock", "door_1")
    registry = er.async_get(hass)
    original = registry.async_get(lock_id)
    hass.config_entries.async_update_entry(
        loaded_entry,
        data={**loaded_entry.data, "locks": [{**DATA["locks"][0], "name": "Garden door"}]},
    )
    await hass.async_block_till_done()
    assert entity_id(hass, "lock", "door_1") == lock_id
    assert registry.async_get(lock_id).unique_id == original.unique_id
    assert registry.async_get(lock_id).original_name == "Garden door"
    assert "Garden door" in hass.states.get(lock_id).attributes["friendly_name"]
    diagnostics = await async_get_config_entry_diagnostics(hass, loaded_entry)
    assert "Garden door" not in str(diagnostics)
    device_io["unlock"].assert_not_called()


async def test_unload_does_not_recreate_release_pulse_from_late_acknowledgement(
    hass, loaded_entry, device_io
):
    from unittest.mock import patch

    runtime = loaded_entry.runtime_data
    request_entered, reply = asyncio.Event(), asyncio.Event()
    shutdown_entered, shutdown_finish = asyncio.Event(), asyncio.Event()
    original_shutdown = runtime.coordinator.async_shutdown

    async def unlock(_door):
        request_entered.set()
        await reply.wait()

    async def shutdown():
        shutdown_entered.set()
        await shutdown_finish.wait()
        await original_shutdown()

    device_io["unlock"].side_effect = unlock
    opening = asyncio.create_task(runtime.async_unlock(1))
    await request_entered.wait()
    with patch.object(runtime.coordinator, "async_shutdown", shutdown):
        unloading = asyncio.create_task(hass.config_entries.async_unload(loaded_entry.entry_id))
        try:
            await shutdown_entered.wait()
            reply.set()
            result = (await asyncio.gather(opening, return_exceptions=True))[0]
        finally:
            reply.set()
            shutdown_finish.set()
            await asyncio.gather(opening, unloading, return_exceptions=True)
    assert runtime._cancel_pulse is None
    assert runtime.released is False
    assert isinstance(result, HomeAssistantError)
    assert result.translation_key == "release_unconfirmed"
    device_io["unlock"].assert_awaited_once_with(1)


async def test_closing_runtime_rejects_new_release_before_session_is_closed(
    hass, loaded_entry, device_io
):
    from unittest.mock import patch

    runtime = loaded_entry.runtime_data
    shutdown_entered, shutdown_finish = asyncio.Event(), asyncio.Event()
    original_shutdown = runtime.coordinator.async_shutdown

    async def shutdown():
        shutdown_entered.set()
        await shutdown_finish.wait()
        await original_shutdown()

    with patch.object(runtime.coordinator, "async_shutdown", shutdown):
        unloading = asyncio.create_task(hass.config_entries.async_unload(loaded_entry.entry_id))
        try:
            await shutdown_entered.wait()
            assert not runtime.session.is_closed
            result = (await asyncio.gather(runtime.async_unlock(1), return_exceptions=True))[0]
        finally:
            shutdown_finish.set()
            await unloading
    assert isinstance(result, ServiceValidationError)
    assert result.translation_key == "connection_closed"
    device_io["unlock"].assert_not_awaited()
