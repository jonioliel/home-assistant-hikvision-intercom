"""Actual HA authorization, durability, diagnostics and read-lane behavior."""

import asyncio
import json
from copy import copy
from unittest.mock import AsyncMock, patch

import pytest

from custom_components.hikvision_intercom.access.acceptance import Acceptance
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.event_manager import get_events
from custom_components.hikvision_intercom.storage import AccessStore

from .test_events import live
from .test_websocket import request


async def test_health_snapshot_is_private_and_does_not_touch_device(
    hass, loaded_entry, hass_ws_client, device_io
):
    client = await hass_ws_client(hass)
    with patch(
        "custom_components.hikvision_intercom.health_api.MediaClient.inspect", new=AsyncMock()
    ) as probe:
        result = await request(client, "health/get", station_id=loaded_entry.entry_id)
        assert result["success"]
        assert result["result"]["format"] == "hikvision_intercom.compatibility"
        encoded = json.dumps(result)
        assert "demo-secret" not in encoded and "DEMO-SERIAL" not in encoded
        probe.assert_not_called()
    device_io["unlock"].assert_not_called()


async def test_acceptance_persist_reload_revision_and_no_commands(
    hass, loaded_entry, hass_ws_client, device_io
):
    client = await hass_ws_client(hass)
    station = loaded_entry.entry_id
    result = await request(client, "acceptance/get", station_id=station)
    assert result["result"]["results"] == {}
    saved = await request(
        client,
        "acceptance/update",
        station_id=station,
        step="pin_remove",
        state="passed",
        revision=0,
    )
    assert saved["success"] and saved["result"]["revision"] == 1
    stale = await request(
        client, "acceptance/update", station_id=station, step="relay", state="passed", revision=0
    )
    assert stale["error"]["code"] == "revision_conflict"
    store = AccessStore(hass, key=f"{DOMAIN}.acceptance")
    clone = Acceptance(store.async_save)
    await clone.async_load(await store.async_load())
    assert clone.public(station) == saved["result"]
    device_io["unlock"].assert_not_called()
    device_io["write_person"].assert_not_called()


async def test_event_detail_and_export_do_not_export_person(hass, loaded_entry, hass_ws_client):
    loaded_entry.runtime_data.events.ingest(
        live(name="Private Resident", employeeNoString="AA42", doorNo=1)
    )
    manager = get_events(hass)
    row = manager.query({})["records"][0]
    assert row["evidence"]["identity_state"] == "identified"
    client = await hass_ws_client(hass)
    detail = await request(client, "events/detail", event_id=row["id"])
    assert detail["result"]["record"]["person_name"] == "Private Resident"
    export = await request(client, "events/support", event_id=row["id"])
    assert export["success"]
    encoded = json.dumps(export)
    assert (
        "Private Resident" not in encoded and "AA42" not in encoded and "station_id" not in encoded
    )
    assert (await request(client, "events/support", event_id="missing"))["success"] is False
    stored = manager._data()["records"][0]
    assert "evidence" not in stored


async def test_health_refresh_reads_only_and_does_not_block_snapshot(
    hass, loaded_entry, hass_ws_client, device_io
):
    client = await hass_ws_client(hass)
    other = await hass_ws_client(hass)
    entered = asyncio.Event()
    finish = asyncio.Event()

    async def inspect():
        entered.set()
        await finish.wait()
        return {"call_commands": ["reject"], "errors": {}, "audio_session_tested": False}

    with (
        patch(
            "custom_components.hikvision_intercom.health_api.MediaClient.inspect",
            side_effect=inspect,
        ),
        patch.object(loaded_entry.runtime_data.clock, "async_refresh", new=AsyncMock()),
    ):
        task = asyncio.create_task(
            request(client, "health/refresh", station_id=loaded_entry.entry_id)
        )
        await entered.wait()
        read = await request(other, "health/get", station_id=loaded_entry.entry_id)
        assert read["success"]
        busy = await request(other, "health/refresh", station_id=loaded_entry.entry_id)
        assert busy["success"] is False
        finish.set()
        assert (await task)["result"]["media"]["call_commands"] == ["reject"]
    device_io["unlock"].assert_not_called()


async def test_media_signal_is_explicit_and_serialized(hass, loaded_entry, hass_ws_client):
    client = await hass_ws_client(hass)
    other = await hass_ws_client(hass)
    entered, finish = asyncio.Event(), asyncio.Event()

    async def signal(_command):
        entered.set()
        await finish.wait()
        return {"acknowledged": True, "physical_result": "unverified"}

    async def send(connection):
        await connection.send_json_auto_id(
            {
                "type": f"{DOMAIN}/media/signal",
                "station_id": loaded_entry.entry_id,
                "command": "reject",
            }
        )
        return await connection.receive_json()

    with patch(
        "custom_components.hikvision_intercom.health_api.MediaClient.signal", side_effect=signal
    ) as operation:
        pending = asyncio.create_task(send(client))
        await entered.wait()
        busy = await send(other)
        assert busy["error"]["code"] == "device_busy"
        finish.set()
        result = await pending
        assert result["result"] == {"acknowledged": True, "physical_result": "unverified"}
        operation.assert_awaited_once_with("reject")


async def test_call_context_caches_result_but_never_writes(
    hass, loaded_entry, hass_ws_client, device_io
):
    client = await hass_ws_client(hass)
    runtime = loaded_entry.runtime_data
    result = {"acknowledged": None, "observation": "unavailable"}
    hass.data[DOMAIN].setdefault("call_results", {})[loaded_entry.entry_id] = (runtime, result)
    with patch(
        "custom_components.hikvision_intercom.health_api.MediaClient.call_context",
        new=AsyncMock(return_value={"state": "idle", "call_commands": ["reject"]}),
    ):
        response = await request(client, "media/call", station_id=loaded_entry.entry_id)
    assert response["result"]["last_result"] == result
    assert response["result"]["busy"] is False
    device_io["unlock"].assert_not_called()


async def test_call_context_rejects_replaced_runtime(hass, loaded_entry, hass_ws_client):
    client = await hass_ws_client(hass)
    old = loaded_entry.runtime_data

    async def context():
        loaded_entry.runtime_data = object()
        return {"state": "idle", "call_commands": []}

    try:
        with patch(
            "custom_components.hikvision_intercom.health_api.MediaClient.call_context",
            side_effect=context,
        ):
            response = await request(client, "media/call", station_id=loaded_entry.entry_id)
        assert response["error"]["code"] == "station_unloaded"
    finally:
        loaded_entry.runtime_data = old


async def test_call_operation_cancelled_at_runtime_unload(hass, loaded_entry, hass_ws_client):
    entered = asyncio.Event()
    cancelled = asyncio.Event()

    async def signal(_command):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    client = await hass_ws_client(hass)
    from custom_components.hikvision_intercom.health_api import dispatch_health

    with patch(
        "custom_components.hikvision_intercom.health_api.MediaClient.signal", side_effect=signal
    ):
        task = asyncio.create_task(
            dispatch_health(
                hass, "media/signal", {"station_id": loaded_entry.entry_id, "command": "reject"}
            )
        )
        await entered.wait()
        await hass.config_entries.async_unload(loaded_entry.entry_id)
        await asyncio.gather(task, return_exceptions=True)
    assert cancelled.is_set()
    assert not hass.data[DOMAIN]["call_commands_busy"]
    assert not hass.data[DOMAIN]["call_operations"]
    await client.close()


async def test_trace_uses_existing_observations_without_device_actions(
    hass, loaded_entry, hass_ws_client, device_io
):
    client = await hass_ws_client(hass)
    started = await request(client, "events/trace_start", station_id=loaded_entry.entry_id)
    assert started["success"]
    assert not (await request(client, "events/trace_start", station_id=loaded_entry.entry_id))[
        "success"
    ]
    loaded_entry.runtime_data.events.ingest(
        live(181, name="PRIVATE_NAME", employeeNoString="PRIVATE_ID")
    )
    report = await request(client, "events/trace_get", station_id=loaded_entry.entry_id)
    encoded = json.dumps(report)
    assert "PRIVATE" not in encoded
    assert len(report["result"]["capture"]["records"]) >= 2
    stopped = await request(
        client,
        "events/trace_stop",
        station_id=loaded_entry.entry_id,
        capture_id=started["result"]["capture"]["capture_id"],
    )
    assert stopped["result"]["capture"]["state"] == "stopped"
    row = get_events(hass).query({})["records"][0]
    support = await request(client, "events/support", event_id=row["id"])
    assert support["result"]["source_identity"]["source_fields"]["name"] == "provided"
    assert "PRIVATE" not in json.dumps(support)
    device_io["unlock"].assert_not_called()
    device_io["write_person"].assert_not_called()


async def test_manual_history_never_moves_recovery_cursor_or_accepts_rows(
    hass, loaded_entry, hass_ws_client
):
    client = await hass_ws_client(hass)
    events = get_events(hass)
    before = dict(events.cursors)
    records = list(events.cache.rows)
    with patch(
        "custom_components.hikvision_intercom.client.history_diagnostics.inspect_history",
        new=AsyncMock(return_value={"complete": True, "records": 3}),
    ):
        response = await request(
            client,
            "events/history_inspect",
            station_id=loaded_entry.entry_id,
            start="2026-09-09T08:00:00Z",
            end="2026-09-09T09:00:00Z",
        )
    assert response["result"]["records"] == 3
    assert events.cursors == before and list(events.cache.rows) == records


async def test_actual_camera_exposes_registered_webrtc_provider(hass, loaded_entry, hass_ws_client):
    from unittest.mock import Mock

    camera_entity = next(state.entity_id for state in hass.states.async_all("camera"))
    camera = hass.data["camera"].get_entity(camera_entity)
    client = await hass_ws_client(hass)

    async def capabilities():
        await client.send_json_auto_id({"type": "camera/capabilities", "entity_id": camera_entity})
        return (await client.receive_json())["result"]["frontend_stream_types"]

    assert await capabilities() == ["hls"]
    provider = Mock()
    provider.async_register_camera = AsyncMock()
    provider.async_unregister_camera = AsyncMock()
    with patch(
        "homeassistant.components.camera.async_get_supported_provider",
        new=AsyncMock(return_value=provider),
    ):
        await camera.async_refresh_providers()
        assert set(await capabilities()) == {"hls", "web_rtc"}
        provider.async_register_camera.assert_awaited_once_with(camera)
    await camera.async_refresh_providers()
    assert await capabilities() == ["hls"]
    provider.async_unregister_camera.assert_awaited_once_with(camera)


@pytest.mark.parametrize("transition", ["closing", "replacement"])
async def test_health_refresh_rejects_runtime_change_during_media_read(
    hass, loaded_entry, device_io, transition
):
    from custom_components.hikvision_intercom.access.models import AccessError
    from custom_components.hikvision_intercom.health_api import dispatch_health

    runtime = loaded_entry.runtime_data
    entered, finish = asyncio.Event(), asyncio.Event()

    async def inspect():
        entered.set()
        await finish.wait()
        return {"call_commands": ["reject"], "errors": {}}

    with (
        patch(
            "custom_components.hikvision_intercom.health_api.MediaClient.inspect",
            side_effect=inspect,
        ),
        patch.object(runtime.clock, "async_refresh", new=AsyncMock()),
    ):
        task = asyncio.create_task(
            dispatch_health(hass, "health/refresh", {"station_id": loaded_entry.entry_id})
        )
        try:
            await entered.wait()
            if transition == "closing":
                runtime._closing = True
            else:
                loaded_entry.runtime_data = copy(runtime)
            finish.set()
            with pytest.raises(AccessError) as raised:
                await task
            assert raised.value.code == "station_unloaded"
            assert loaded_entry.entry_id not in hass.data[DOMAIN].get("media_evidence", {})
            assert not hass.data[DOMAIN]["health_reads"]
        finally:
            finish.set()
            await asyncio.gather(task, return_exceptions=True)
            runtime._closing = False
            loaded_entry.runtime_data = runtime
    device_io["unlock"].assert_not_called()
    device_io["write_person"].assert_not_called()
