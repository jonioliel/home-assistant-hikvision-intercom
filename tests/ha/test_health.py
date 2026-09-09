"""Actual HA authorization, durability, diagnostics and read-lane behavior."""

import asyncio
import json
from unittest.mock import AsyncMock, patch

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
