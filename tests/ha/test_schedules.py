"""Actual HA administrator API, independent private store, and no device writes."""

import json
import logging
from pathlib import Path
from unittest.mock import AsyncMock, patch

from custom_components.hikvision_intercom.access.schedules import DAYS, ScheduleLibrary
from custom_components.hikvision_intercom.access_runtime import get_manager
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.storage import AccessStore

from .test_websocket import request


def draft():
    return {
        "name": "Office",
        "weekly": {
            day: [{"start": "09:00", "end": "17:00"}] if day == "Monday" else [] for day in DAYS
        },
        "holidays": [],
    }


async def test_admin_schedule_create_preview_update_delete_without_access_writes(
    hass, loaded_entry, hass_ws_client, device_io
):
    client = await hass_ws_client(hass)
    result = await request(client, "schedules/create", data=draft())
    assert result["success"]
    item = result["result"]
    result = await request(
        client, "schedules/preview", data=draft(), date="2026-09-07", time="12:00"
    )
    assert result["result"]["within_window"] and not result["result"]["applied"]
    data = draft()
    data["name"] = "Edited"
    result = await request(
        client, "schedules/update", schedule_id=item["id"], revision=1, data=data
    )
    assert result["result"]["revision"] == 2
    stale = await request(client, "schedules/delete", schedule_id=item["id"], revision=1)
    assert stale["error"]["code"] == "revision_conflict"
    assert (await request(client, "schedules/list"))["result"][0]["name"] == "Edited"
    assert (await request(client, "schedules/delete", schedule_id=item["id"], revision=2))[
        "success"
    ]
    assert (await request(client, "schedules/list"))["result"] == []
    device_io["unlock"].assert_not_called()
    device_io["write_person"].assert_not_called()
    assert not get_manager(hass).repository.users()


async def test_schedule_storage_roundtrip_is_private_and_independent(hass, loaded_entry):
    library = hass.data[DOMAIN]["schedules"]
    saved = await library.async_save(draft())
    store = AccessStore(hass, key=f"{DOMAIN}.schedules")
    reloaded = ScheduleLibrary(store.async_save)
    await reloaded.async_load(await store.async_load())
    assert reloaded.list() == [saved]
    mode = await hass.async_add_executor_job(lambda: Path(store.path).stat().st_mode & 0o777)
    assert mode == 0o600 and not get_manager(hass).repository.users()


async def test_invalid_schedule_payload_is_not_echoed_to_logs(
    hass, loaded_entry, hass_ws_client, caplog
):
    caplog.set_level(logging.DEBUG, logger="homeassistant.components.websocket_api.http.connection")
    client = await hass_ws_client(hass)
    data = draft()
    data["weekly"]["Monday"][0]["start"] = "PRIVATE_MALFORMED_INPUT"
    result = await request(client, "schedules/create", data=data)
    assert result["error"]["code"] == "schedule_invalid_time"
    assert "PRIVATE_MALFORMED_INPUT" not in json.dumps(result) + caplog.text
    assert not hass.data[DOMAIN]["schedules"].list()
    result = await request(
        client, "schedules/update", data=draft(), schedule_id="bad", revision=True
    )
    assert result["error"]["code"] == "invalid_fields"


async def test_readiness_does_not_enable_assignment_and_bounds_concurrency(
    hass, loaded_entry, hass_ws_client, device_io
):
    client = await hass_ws_client(hass)
    with patch(
        "custom_components.hikvision_intercom.websocket.inspect_schedules",
        AsyncMock(return_value={"can_apply": False, "checks": []}),
    ) as inspect:
        result = await request(client, "schedules/readiness", station_id=loaded_entry.entry_id)
        assert result["success"] and not result["result"]["can_apply"]
        assert inspect.await_count == 1 and not hass.data[DOMAIN]["schedule_reads"]
        hass.data[DOMAIN]["schedule_reads"] = {loaded_entry.entry_id}
        result = await request(client, "schedules/readiness", station_id=loaded_entry.entry_id)
        assert result["error"]["code"] == "schedule_read_busy" and inspect.await_count == 1
        hass.data[DOMAIN]["schedule_reads"] = set()
    result = await request(
        client,
        "users/create",
        data={
            "display_name": "No assignment",
            "assignments": {
                loaded_entry.entry_id: {"allowed_locks": [1], "schedule_template": "1"}
            },
        },
    )
    assert not result["success"]
    device_io["unlock"].assert_not_called()
    device_io["write_person"].assert_not_called()


async def test_missing_schedule_store_blocks_drafts_but_not_overview(
    hass, loaded_entry, hass_ws_client
):
    client = await hass_ws_client(hass)
    hass.data[DOMAIN]["schedules"] = None
    result = await request(client, "schedules/list")
    assert result["error"]["code"] == "invalid_storage"
    assert (await request(client, "overview"))["success"]


def inventory_summary():
    return {
        "checked_at": "2026-09-09T00:00:00+00:00",
        "complete": False,
        "can_apply": False,
        "ownership_checked": False,
        "users_checked": False,
        "checks": [
            {"kind": k, "capabilities": None, "state": "failed"}
            for k in ("template", "weekly", "holiday_group", "holiday")
        ],
    }


async def test_assessment_reads_fresh_inventory_and_does_not_save_or_write(
    hass, loaded_entry, hass_ws_client, device_io
):
    client = await hass_ws_client(hass)
    data = draft()
    data["name"] = "PRIVATE_DRAFT_NAME"
    before = hass.data[DOMAIN]["schedules"].list()
    with patch(
        "custom_components.hikvision_intercom.websocket.inspect_inventory",
        AsyncMock(return_value=inventory_summary()),
    ) as inspect:
        result = await request(
            client, "schedules/assess", station_id=loaded_entry.entry_id, data=data
        )
    assert result["success"] and inspect.await_count == 1
    assert (
        result["result"]["assessment"]["state"] == "unknown" and not result["result"]["can_apply"]
    )
    assert "PRIVATE_DRAFT_NAME" not in json.dumps(result)
    assert hass.data[DOMAIN]["schedules"].list() == before
    device_io["unlock"].assert_not_called()
    device_io["write_person"].assert_not_called()


async def test_invalid_draft_is_rejected_before_inventory_read(hass, loaded_entry, hass_ws_client):
    client = await hass_ws_client(hass)
    data = draft()
    data["weekly"]["Monday"][0]["start"] = "bad"
    with patch(
        "custom_components.hikvision_intercom.websocket.inspect_inventory", AsyncMock()
    ) as inspect:
        result = await request(
            client, "schedules/assess", station_id=loaded_entry.entry_id, data=data
        )
    assert result["error"]["code"] == "schedule_invalid_time" and not inspect.called


async def test_assessment_shares_station_and_fleet_read_limits(hass, loaded_entry, hass_ws_client):
    client = await hass_ws_client(hass)
    hass.data[DOMAIN]["schedule_reads"] = {loaded_entry.entry_id}
    with patch(
        "custom_components.hikvision_intercom.websocket.inspect_inventory", AsyncMock()
    ) as inspect:
        result = await request(
            client, "schedules/assess", station_id=loaded_entry.entry_id, data=draft()
        )
    assert result["error"]["code"] == "schedule_read_busy" and not inspect.called
    hass.data[DOMAIN]["schedule_reads"] = set()


async def test_assessment_does_not_need_writable_draft_storage(hass, loaded_entry, hass_ws_client):
    client = await hass_ws_client(hass)
    hass.data[DOMAIN]["schedules"] = None
    with patch(
        "custom_components.hikvision_intercom.websocket.inspect_inventory",
        AsyncMock(return_value=inventory_summary()),
    ):
        result = await request(
            client, "schedules/assess", station_id=loaded_entry.entry_id, data=draft()
        )
    assert result["success"] and not hass.data[DOMAIN]["schedule_reads"]


async def test_assessment_rejects_late_result_after_station_unload(
    hass, loaded_entry, hass_ws_client
):
    import asyncio

    client = await hass_ws_client(hass)
    entered, release = asyncio.Event(), asyncio.Event()

    async def inspect(_):
        entered.set()
        await release.wait()
        return inventory_summary()

    with patch("custom_components.hikvision_intercom.websocket.inspect_inventory", inspect):
        task = asyncio.create_task(
            request(client, "schedules/assess", station_id=loaded_entry.entry_id, data=draft())
        )
        await entered.wait()
        await hass.config_entries.async_unload(loaded_entry.entry_id)
        release.set()
        result = await task
    assert result["error"]["code"] == "station_unloaded"
    assert not hass.data[DOMAIN]["schedule_reads"]
