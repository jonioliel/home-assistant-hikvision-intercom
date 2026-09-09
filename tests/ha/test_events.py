"""Native HA events, privacy, recovery and lifecycle using real HA entities."""

import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.helpers import entity_registry as er

from custom_components.hikvision_intercom.client.client import CallState
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.event_manager import get_events
from custom_components.hikvision_intercom.exceptions import HikvisionConnectionError

from .test_websocket import request


def state(hass, key):
    entity = er.async_get(hass).async_get_entity_id("event", DOMAIN, f"DEMO-SERIAL_{key}")
    return hass.states.get(entity)


def live(minor=181, **fields):
    return {
        "eventType": "AccessControllerEvent",
        "eventState": "active",
        "dateTime": datetime.now(UTC).isoformat(),
        "AccessControllerEvent": {
            "majorEventType": 5,
            "subEventType": minor,
            "serialNo": 1,
            "currentEvent": True,
            **fields,
        },
    }


async def test_live_access_entity_and_dedupe_do_not_expose_secrets(hass, loaded_entry):
    monitor = loaded_entry.runtime_data.events
    data = live(cardNo="9876543210", password="private-pin", employeeNoString="42", doorNo=1)
    monitor.ingest(data)
    await hass.async_block_till_done()
    first = state(hass, "access")
    assert first.attributes["event_type"] == "access_granted"
    assert first.attributes["door"] == 1 and first.attributes["authentication"] == "pin"
    assert "private-pin" not in str(first.as_dict()) and "9876543210" not in str(first.as_dict())
    monitor.ingest(data)
    await hass.async_block_till_done()
    assert state(hass, "access").state == first.state
    manager = get_events(hass)
    assert len(manager.query({})["records"]) == 1
    await manager.async_flush()
    stored = await manager.store.async_load()
    assert len(stored["records"]) == 1 and "private-pin" not in str(stored)


async def test_replayed_old_or_unknown_time_events_only_enter_history(hass, loaded_entry):
    monitor = loaded_entry.runtime_data.events
    monitor.ingest(live(currentEvent=False))
    old = live()
    old["dateTime"] = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    monitor.ingest(old)
    monitor.ingest(
        {"major": 5, "minor": 150, "time": datetime.now(UTC).isoformat()}, historical=True
    )
    await hass.async_block_till_done()
    assert state(hass, "access").state == "unknown"
    records = get_events(hass).query({})["records"]
    assert len(records) == 3 and all(row["recovered"] for row in records)


async def test_doorbell_edge_and_reconnect_baseline(hass, loaded_entry, device_io):
    coordinator = loaded_entry.runtime_data.coordinator
    device_io["call"].return_value = CallState("ringing", "ring")
    await coordinator.async_refresh()
    await hass.async_block_till_done()
    first = state(hass, "doorbell")
    assert first.attributes["event_type"] == "ring"
    await coordinator.async_refresh()
    await hass.async_block_till_done()
    assert state(hass, "doorbell").state == first.state
    device_io["call"].side_effect = HikvisionConnectionError("offline")
    await coordinator.async_refresh()
    device_io["call"].side_effect = None
    await coordinator.async_refresh()
    await hass.async_block_till_done()
    assert state(hass, "doorbell").state == first.state
    assert len(get_events(hass).query({})["records"]) == 1


async def test_event_admin_query_filters_and_no_secret_error_echo(
    hass, loaded_entry, hass_ws_client
):
    loaded_entry.runtime_data.events.ingest(live(150, employeeNoString="42", name="Dana"))
    client = await hass_ws_client(hass)
    response = await request(client, "events/list", filters={"result": "denied", "person": "Dana"})
    assert response["success"] and len(response["result"]["records"]) == 1
    response = await request(client, "events/list", filters={"pin": "secret-event-filter"})
    assert not response["success"] and "secret-event-filter" not in str(response)


async def test_event_history_save_failure_is_visible(hass, loaded_entry):
    manager = get_events(hass)
    loaded_entry.runtime_data.events.ingest(live())
    with patch.object(manager.store, "async_save", side_effect=OSError("private-path")):
        await manager.async_flush()
    assert manager.query({})["storage_failed"]
    await manager.async_flush()
    assert not manager.storage_failed


async def test_stream_task_cancelled_and_session_closed_on_unload(hass, loaded_entry):
    monitor = loaded_entry.runtime_data.events
    entered = asyncio.Event()
    session = AsyncMock()

    async def stream(_session):
        entered.set()
        yield live()
        await asyncio.Future()

    with (
        patch(
            "custom_components.hikvision_intercom.event_manager.create_event_session",
            return_value=session,
        ),
        patch.object(monitor.client, "async_stream", stream),
    ):
        task = hass.async_create_background_task(
            monitor._stream(), "test stream", eager_start=False
        )
        monitor._tasks.append(task)
        await entered.wait()
        assert await hass.config_entries.async_unload(loaded_entry.entry_id)
        assert task.cancelled()
        session.aclose.assert_awaited_once()
        assert not get_events(hass).stations


async def test_history_failure_preserves_cursor_and_success_does_not_trigger(hass, loaded_entry):
    monitor = loaded_entry.runtime_data.events
    manager = get_events(hass)
    old = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    manager.cursors[loaded_entry.entry_id] = old
    monitor.client.page_size = 30
    real_sleep = asyncio.sleep

    async def sleep(delay):
        if delay:
            raise asyncio.CancelledError
        await real_sleep(0)

    with (
        patch.object(
            monitor.client, "async_history", side_effect=HikvisionConnectionError("offline")
        ),
        patch("custom_components.hikvision_intercom.event_manager.asyncio.sleep", sleep),
    ):
        with pytest.raises(asyncio.CancelledError):
            await monitor._history()
    assert manager.cursors[loaded_entry.entry_id] == old and monitor.history_state == "incomplete"
    row = {"major": 5, "minor": 181, "time": (datetime.now(UTC) - timedelta(minutes=1)).isoformat()}
    with (
        patch.object(monitor.client, "async_history", return_value=[row, row]),
        patch("custom_components.hikvision_intercom.event_manager.asyncio.sleep", sleep),
    ):
        with pytest.raises(asyncio.CancelledError):
            await monitor._history()
    assert manager.cursors[loaded_entry.entry_id] != old and monitor.history_state == "recovered"
    assert len(manager.query({})["records"]) == 2
    assert state(hass, "access").state == "unknown"


async def test_event_report_and_csv_cover_all_filtered_pages_without_credentials(
    hass, loaded_entry, hass_ws_client
):
    import csv
    import io

    monitor = loaded_entry.runtime_data.events
    for i in range(230):
        monitor.ingest(
            live(
                1 if i % 2 else 150,
                serialNo=i + 1000,
                cardNo="000099991234",
                password="PRIVATE_PIN",
                name="=UNTRUSTED()",
            )
        )
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)
    result = await request(client, "events/report", filters={})
    assert result["success"]
    assert result["result"]["totals"]["records"] == 230
    assert "PRIVATE_PIN" not in str(result) and "000099991234" not in str(result)
    result = await request(client, "events/export", filters={"result": "denied"})
    assert result["success"] and result["result"]["totals"]["records"] == 115
    rows = list(csv.DictReader(io.StringIO(result["result"]["csv"].removeprefix("\ufeff"))))
    assert len(rows) == 115 and all(row["person_name"].startswith("'=") for row in rows)
    assert "PRIVATE_PIN" not in str(result) and "000099991234" not in str(result)
    result = await request(client, "events/report", filters={"before": "cursor"})
    assert result["error"]["code"] == "invalid_fields"
    result = await request(client, "events/export", filters={"limit": 1})
    assert result["error"]["code"] == "invalid_fields"


async def test_event_name_uses_only_observed_ownership_on_its_station(hass, loaded_entry):
    runtime = loaded_entry.runtime_data
    repo = runtime.access_manager.repository
    user = await repo.async_create({"display_name": "Bound resident", "employee_no": "00042"})
    runtime.events.ingest(live(employeeNo="00042", serialNo=6001))
    row = get_events(hass).query({})["records"][0]
    assert row["employee_no"] == "00042" and row["person_name"] is None
    await repo.async_bind(runtime.station_id, user.id, fingerprint="observed")
    runtime.events.ingest(live(employeeNo="00042", serialNo=6002))
    row = get_events(hass).query({})["records"][0]
    assert row["person_name"] == "Bound resident"
    runtime.events.ingest(live(employeeNo="00042", name="Device name", serialNo=6003))
    assert get_events(hass).query({})["records"][0]["person_name"] == "Device name"


async def test_history_before_adoption_is_not_named_from_an_older_central_user(hass, loaded_entry):
    runtime = loaded_entry.runtime_data
    repo = runtime.access_manager.repository
    now = datetime.now(UTC)
    with patch(
        "custom_components.hikvision_intercom.access.repository.utc_now",
        return_value=(now - timedelta(minutes=10)).isoformat(),
    ):
        user = await repo.async_create({"display_name": "Current resident", "employee_no": "00042"})
    with patch(
        "custom_components.hikvision_intercom.access.repository.utc_now",
        return_value=(now - timedelta(minutes=1)).isoformat(),
    ):
        await repo.async_adopt(
            runtime.station_id,
            {"employee_no": "00042"},
            fingerprint="observed",
            existing_user_id=user.id,
            expected_revision=user.revision,
        )
    historical = {
        "major": 5,
        "minor": 181,
        "employeeNoString": "00042",
        "time": (now - timedelta(minutes=5)).isoformat(),
    }
    runtime.events.ingest(historical, historical=True)
    old = get_events(hass).query({})["records"][0]
    assert old["person_name"] is None and old["recovered"]
    runtime.events.ingest({**historical, "name": "Source resident", "serialNo": 2}, historical=True)
    rows = get_events(hass).query({})["records"]
    assert any(row["person_name"] == "Source resident" for row in rows)
    runtime.events.ingest(live(employeeNoString="00042", serialNo=3))
    assert get_events(hass).query({})["records"][0]["person_name"] == "Current resident"
