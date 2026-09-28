"""Exercise new operation contracts through the actual infrastructure boundary."""

import json
from copy import deepcopy
from unittest.mock import AsyncMock, patch

from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.operations_center import OperationsCenter
from custom_components.hikvision_intercom.operations_runtime import audit_denial
from custom_components.hikvision_intercom.panel_permissions import requirements
from custom_components.hikvision_intercom.websocket import COMMANDS


async def request(client, command, **data):
    await client.send_json_auto_id({"type": f"{DOMAIN}/{command}", **data})
    return await client.receive_json()


async def test_platform_contract_admin_only_and_does_not_disclose_keys(
    hass, loaded_entry, hass_ws_client, hass_read_only_access_token
):
    admin = await hass_ws_client(hass)
    result = await request(admin, "platform/get")
    assert result["success"]
    assert loaded_entry.entry_id in result["result"]["catalog"]
    assert "signing_key" not in result["result"] and "webhook_key" not in result["result"]
    for command in COMMANDS:
        if command.startswith("platform/"):
            assert requirements(command) is None
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    denied = await request(reader, "platform/get")
    assert not denied["success"] and denied["error"]["code"] == "unauthorized"
    assert hass.data[DOMAIN]["operations_center"].data["journal"][-1]["command"] == "platform/get"


async def test_invalid_request_audit_never_retains_password_or_pin(
    hass, loaded_entry, hass_ws_client
):
    client = await hass_ws_client(hass)
    result = await request(
        client,
        "platform/save",
        collection="templates",
        record_id="",
        revision=True,
        values={"password": "SECRET_PIN_AND_PASSWORD"},
    )
    assert not result["success"]
    ops = hass.data[DOMAIN]["operations_center"]
    assert "SECRET_PIN_AND_PASSWORD" not in json.dumps(ops.data["journal"])
    assert ops.data["journal"][-1]["code"] == "invalid_fields"


async def test_platform_does_not_shadow_existing_operation_dispatch(
    hass, loaded_entry, hass_ws_client
):
    client = await hass_ws_client(hass)
    result = await request(client, "operations/query", filters={}, offset=0, limit=20, snapshot="")
    assert result["success"], result
    result = await request(client, "schedules/operations_list")
    assert result["success"], result


async def test_report_views_validate_real_filters_and_survive_settings_reload(
    hass, loaded_entry, hass_ws_client
):
    client = await hass_ws_client(hass)
    result = await request(
        client,
        "platform/save",
        collection="views",
        record_id="",
        revision=0,
        values={"label": "Denied access", "filters": {"result": "denied"}},
    )
    assert result["success"]
    identifier = result["result"]["id"]
    report = await request(client, "platform/report", collection="views", record_id=identifier)
    assert report["success"] and "print_records" in report["result"]
    ops = hass.data[DOMAIN]["operations_center"]
    reloaded = OperationsCenter(AsyncMock())
    reloaded.load(deepcopy(ops.data))
    assert reloaded.data["views"][identifier]["values"]["filters"] == {"result": "denied"}


async def test_fleet_review_is_read_only_and_apply_does_not_claim_failed_station_verified(
    hass, loaded_entry, hass_ws_client
):
    client = await hass_ws_client(hass)
    observed = {
        "door": 1,
        "values": {"openDuration": 5},
        "constraints": {"openDuration": {"type": "integer", "min": 1, "max": 255}},
    }
    with (
        patch(
            "custom_components.hikvision_intercom.operations_api.read_configuration",
            AsyncMock(return_value=observed),
        ),
        patch(
            "custom_components.hikvision_intercom.technical_api.dispatch_technical",
            AsyncMock(side_effect=TimeoutError),
        ) as write,
    ):
        result = await request(
            client,
            "platform/config_preview",
            station_ids=[loaded_entry.entry_id],
            door=1,
            changes={"openDuration": 7},
        )
        assert result["success"] and result["result"]["apply_count"] == 1
        write.assert_not_called()
        token = result["result"]["review_id"]
        denied = await request(client, "platform/config_apply", review_id=token, confirmed=False)
        assert not denied["success"]
        write.assert_not_called()
        result = await request(client, "platform/config_apply", review_id=token, confirmed=True)
        assert result["success"]
        assert result["result"]["receipts"][0]["state"] == "failed"
        assert write.await_count == 1


async def test_review_cannot_bypass_enabled_second_approver(hass, loaded_entry, hass_ws_client):
    client = await hass_ws_client(hass)
    workflows = hass.data[DOMAIN]["workflows"]
    await workflows.update_settings(
        0, {"idle_minutes": 0, "reauth_sensitive": False, "dual_approval": True}
    )
    result = await request(client, "platform/config_apply", review_id="no-proof", confirmed=True)
    assert not result["success"] and result["error"]["code"] == "approval_command_unsupported"


async def test_integrity_and_demo_are_read_only_and_keep_production_people(
    hass, loaded_entry, hass_ws_client
):
    client = await hass_ws_client(hass)
    repository = hass.data[DOMAIN]["access"].repository
    before = deepcopy(repository._state)
    integrity = await request(client, "platform/integrity")
    assert integrity["success"] and not integrity["result"]["writes_performed"]
    appearance = next(
        row for row in integrity["result"]["checks"] if row["component"] == "appearance_settings"
    )
    assert appearance["state"] == "available"
    demo = await request(client, "platform/demo")
    assert demo["success"] and demo["result"]["device_writes"] == 0
    assert repository._state == before


async def test_retention_is_saved_with_records_and_loaded_before_pruning(
    hass, loaded_entry, hass_ws_client
):
    from custom_components.hikvision_intercom.event_manager import EventManager

    client = await hass_ws_client(hass)
    review = await request(
        client, "platform/retention_preview", values={"days": 90, "count": 10000, "bytes": 1000000}
    )
    assert review["success"]
    applied = await request(
        client, "platform/retention_apply", review_id=review["result"]["review_id"], confirmed=True
    )
    assert applied["success"] and applied["result"]["days"] == 90
    reloaded = EventManager(hass)
    await reloaded.async_load()
    assert reloaded.cache.days == 90 and reloaded.cache.limit == 10000
    await reloaded.async_close()


async def test_security_audit_keeps_service_available_after_storage_failure(hass, loaded_entry):
    ops = hass.data[DOMAIN]["operations_center"]
    with patch.object(ops, "_save", AsyncMock(side_effect=OSError("disk failure"))):
        await audit_denial(hass, "actor", "platform/get", "unauthorized")
    assert not ops.data["journal"]


async def test_retention_does_not_drop_an_event_arriving_during_atomic_write(
    hass, loaded_entry, hass_ws_client
):
    from datetime import UTC, datetime

    from custom_components.hikvision_intercom.events import normalize_event

    events = hass.data[DOMAIN]["events"]
    client = await hass_ws_client(hass)
    review = await request(
        client, "platform/retention_preview", values={"days": 60, "count": 10000, "bytes": 1000000}
    )
    now = datetime.now(UTC)
    row = normalize_event(
        {
            "eventType": "AccessControllerEvent",
            "eventState": "active",
            "dateTime": now.isoformat(),
            "AccessControllerEvent": {
                "currentEvent": True,
                "majorEventType": 5,
                "subEventType": 1,
                "serialNo": 77,
            },
        },
        loaded_entry.entry_id,
        events.key,
        received=now,
        selected_api=1,
    )
    original_save = events.store.async_save

    async def save_and_ingest(data):
        events.accept(row)
        await original_save(data)

    with patch.object(events.store, "async_save", side_effect=save_and_ingest):
        applied = await request(
            client,
            "platform/retention_apply",
            review_id=review["result"]["review_id"],
            confirmed=True,
        )
    assert applied["success"]
    assert row["id"] in events.cache.rows
    await events.async_flush()
    assert row["id"] in {item["id"] for item in (await events.store.async_load())["records"]}


async def test_fleet_failure_does_not_stop_later_station(hass, loaded_entry, hass_ws_client):
    client = await hass_ws_client(hass)
    observed = {
        "values": {"openDuration": 5},
        "constraints": {"openDuration": {"type": "integer", "min": 1, "max": 255}},
    }
    with (
        patch(
            "custom_components.hikvision_intercom.operations_api.station_catalog",
            return_value={"a": "First", "b": "Second"},
        ),
        patch(
            "custom_components.hikvision_intercom.operations_api.station_stamp",
            return_value="proof",
        ),
        patch(
            "custom_components.hikvision_intercom.operations_api.read_configuration",
            AsyncMock(return_value=observed),
        ),
        patch(
            "custom_components.hikvision_intercom.technical_api.dispatch_technical",
            AsyncMock(side_effect=[TimeoutError(), {"verified": True}]),
        ) as apply,
    ):
        review = await request(
            client,
            "platform/config_preview",
            station_ids=["a", "b"],
            door=1,
            changes={"openDuration": 7},
        )
        assert review["success"]
        result = await request(
            client, "platform/config_apply", review_id=review["result"]["review_id"], confirmed=True
        )
        assert result["success"]
        assert [row["state"] for row in result["result"]["receipts"]] == ["failed", "verified"]
        assert apply.await_count == 2


async def test_audit_flood_is_bounded_without_changing_rejection(hass, loaded_entry):
    ops = hass.data[DOMAIN]["operations_center"]
    with patch.object(ops, "append", AsyncMock()) as save:
        for _ in range(80):
            await audit_denial(hass, "reader", "platform/get", "unauthorized")
    assert save.await_count == 60


async def test_configured_webhook_and_daily_summaries_use_bounded_metadata_only(
    hass, loaded_entry, hass_ws_client
):
    import asyncio
    from datetime import UTC, datetime
    from types import SimpleNamespace

    from custom_components.hikvision_intercom.operations_runtime import (
        async_setup_operations,
        publish,
    )

    await hass_ws_client(hass)
    actor = next(user.id for user in await hass.auth.async_get_users() if user.is_admin)
    client = AsyncMock()
    client.post.return_value = SimpleNamespace(status_code=204)
    manager = AsyncMock()
    manager.__aenter__.return_value = client
    with (
        patch("httpx.AsyncClient", return_value=manager),
        patch(
            "custom_components.hikvision_intercom.operations_runtime.async_track_time_interval"
        ) as timer,
    ):
        await async_setup_operations(hass)
        ops = hass.data[DOMAIN]["operations_center"]
        publish(
            hass, "access_event", {"station_id": "s", "pin": "SECRET", "person_name": "PRIVATE"}
        )
        await asyncio.sleep(0)
        client.post.assert_not_called()
        await ops.mutate(
            0,
            lambda data: data.__setitem__(
                "webhook",
                {"enabled": True, "url": "https://receiver.example", "kinds": ["access_event"]},
            ),
        )
        publish(hass, "access_event", {"station_id": "s", "result": "granted", "pin": "SECRET"})
        await asyncio.wait_for(hass.data[DOMAIN]["operations_notifications"].join(), 5)
        assert client.post.await_count == 1
        sent = client.post.call_args.kwargs
        assert b"SECRET" not in sent["content"]
        assert sent["headers"]["X-Smplwise-Signature"].startswith("sha256=")
        now = datetime.now(UTC)
        await ops.save_record(
            "reports",
            "",
            ops.data["revision"],
            {
                "label": "Local summary",
                "filters": {},
                "enabled": True,
                "hour": now.hour,
                "timezone": "UTC",
                "days": [now.weekday()],
            },
            actor,
        )
        tick = timer.call_args.args[1]
        await tick(now)
        await tick(now)
        assert len(ops.data["report_runs"]) == 1
        assert client.post.await_count == 1
