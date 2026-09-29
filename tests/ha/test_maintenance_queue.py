"""Actual authenticated WS boundary and the journalled technical adapter."""

from copy import deepcopy
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.maintenance_api import process
from custom_components.hikvision_intercom.maintenance_jobs import fingerprint
from custom_components.hikvision_intercom.operations_center import DEFAULT_THRESHOLDS

from .test_operations_center import request

OBSERVED = {
    "door": 1,
    "values": {"openDuration": 5, "relayReverseEnabled": True},
    "constraints": {
        "openDuration": {"type": "integer", "min": 1, "max": 255},
        "relayReverseEnabled": {"type": "boolean"},
    },
}
CHANGES = {"openDuration": 7, "relayReverseEnabled": False}
DESIRED = {**OBSERVED["values"], **CHANGES}


async def prepare(client, entry):
    reply = await request(
        client,
        "platform/maintenance_preview",
        station_ids=[entry.entry_id],
        door=1,
        changes=CHANGES,
    )
    assert reply["success"], reply
    return reply["result"]["review_id"]


async def enqueue(client, entry):
    token = await prepare(client, entry)
    denied = await request(client, "platform/maintenance_enqueue", review_id=token, confirmed=False)
    assert not denied["success"]
    reply = await request(client, "platform/maintenance_enqueue", review_id=token, confirmed=True)
    assert reply["success"], reply
    return reply["result"]["job_id"]


async def test_queue_is_admin_only_explicit_and_uses_existing_technical_update(
    hass, loaded_entry, hass_ws_client, hass_read_only_access_token
):
    client = await hass_ws_client(hass)
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    assert not (await request(reader, "platform/maintenance_jobs"))["success"]
    with (
        patch(
            "custom_components.hikvision_intercom.operations_api.read_configuration",
            AsyncMock(return_value=OBSERVED),
        ),
        patch(
            "custom_components.hikvision_intercom.technical_api.dispatch_technical",
            AsyncMock(return_value={"values": DESIRED}),
        ) as write,
    ):
        identifier = await enqueue(client, loaded_entry)
        write.assert_not_awaited()
        jobs = hass.data[DOMAIN]["maintenance_jobs"]
        assert jobs.get(identifier)["rows"][0]["changes"]["relayReverseEnabled"] is False
        await process(hass, datetime.now(UTC))
        assert jobs.get(identifier)["state"] == "verified"
        assert write.await_args.args[1] == "stations/technical_update"
        assert write.await_args.args[2]["confirmed"] is True
        await process(hass, datetime.now(UTC))
        assert write.await_count == 1


@pytest.mark.parametrize("changed", ["mapping", "identity", "window", "actor", "observed"])
async def test_changed_review_does_not_write(hass, loaded_entry, hass_ws_client, changed):
    client = await hass_ws_client(hass)
    read = AsyncMock(return_value=deepcopy(OBSERVED))
    with (
        patch("custom_components.hikvision_intercom.operations_api.read_configuration", read),
        patch(
            "custom_components.hikvision_intercom.technical_api.dispatch_technical", AsyncMock()
        ) as write,
    ):
        identifier = await enqueue(client, loaded_entry)
        jobs = hass.data[DOMAIN]["maintenance_jobs"]
        if changed == "mapping":
            hass.config_entries.async_update_entry(
                loaded_entry,
                data={
                    **loaded_entry.data,
                    "locks": [{"physical_index": 1, "api_id": 2, "confirmed": True}],
                },
            )
        elif changed == "identity":
            jobs.data["jobs"][identifier]["rows"][0]["identity_stamp"] = "b" * 64
        elif changed == "window":
            ops = hass.data[DOMAIN]["operations_center"]
            await ops.save_record(
                "stations",
                loaded_entry.entry_id,
                ops.data["revision"],
                {
                    "zone": "",
                    "owner": "",
                    "tags": [],
                    "thresholds": DEFAULT_THRESHOLDS,
                    "window": {
                        "enabled": False,
                        "days": list(range(7)),
                        "start": "01:00",
                        "end": "23:00",
                        "timezone": "UTC",
                    },
                },
                "admin",
            )
        elif changed == "actor":
            actor = jobs.get(identifier)["actor"]
            original = hass.auth.async_get_user

            async def lookup(uid):
                return (
                    SimpleNamespace(is_active=False, is_admin=True)
                    if uid == actor
                    else await original(uid)
                )

            with patch.object(hass.auth, "async_get_user", lookup):
                await process(hass, datetime.now(UTC))
            write.assert_not_awaited()
            return
        else:
            read.return_value = {**OBSERVED, "values": {**OBSERVED["values"], "openDuration": 6}}
        await process(hass, datetime.now(UTC))
        write.assert_not_awaited()
        assert jobs.get(identifier)["rows"][0]["state"] == "failed"


async def test_new_dual_policy_waits_and_revoked_second_actor_cannot_execute(
    hass, loaded_entry, hass_ws_client
):
    from .test_ordered_approvals import reviewer_client

    client = await hass_ws_client(hass)
    with (
        patch(
            "custom_components.hikvision_intercom.operations_api.read_configuration",
            AsyncMock(return_value=OBSERVED),
        ),
        patch(
            "custom_components.hikvision_intercom.technical_api.dispatch_technical",
            AsyncMock(return_value={"values": DESIRED}),
        ) as write,
    ):
        identifier = await enqueue(client, loaded_entry)
        workflows = hass.data[DOMAIN]["workflows"]
        await workflows.update_settings(
            0, {"idle_minutes": 0, "reauth_sensitive": False, "dual_approval": True}
        )
        jobs = hass.data[DOMAIN]["maintenance_jobs"]
        await process(hass, datetime.now(UTC))
        assert jobs.get(identifier)["state"] == "awaiting_approval"
        write.assert_not_awaited()
        reviewer, second = await reviewer_client(hass, hass_ws_client)
        job = jobs.get(identifier)
        reply = await request(
            second,
            "platform/maintenance_decide",
            job_id=identifier,
            fingerprint=fingerprint(job),
            approve=True,
            confirmed=True,
        )
        assert reply["success"], reply
        original = hass.auth.async_get_user

        async def lookup(uid):
            return (
                SimpleNamespace(is_active=False, is_admin=True)
                if uid == reviewer.id
                else await original(uid)
            )

        with patch.object(hass.auth, "async_get_user", lookup):
            await process(hass, datetime.now(UTC))
        write.assert_not_awaited()
        assert jobs.get(identifier)["state"] == "awaiting_approval"
        await second.close()


async def test_lost_write_ack_recovers_by_readback_through_real_boundary(
    hass, loaded_entry, hass_ws_client
):
    client = await hass_ws_client(hass)
    read = AsyncMock(return_value=OBSERVED)
    with (
        patch("custom_components.hikvision_intercom.operations_api.read_configuration", read),
        patch(
            "custom_components.hikvision_intercom.technical_api.dispatch_technical",
            AsyncMock(side_effect=TimeoutError),
        ) as write,
    ):
        identifier = await enqueue(client, loaded_entry)
        await process(hass, datetime.now(UTC))
        assert (
            hass.data[DOMAIN]["maintenance_jobs"].get(identifier)["rows"][0]["state"] == "writing"
        )
        read.return_value = {**OBSERVED, "values": DESIRED}
        await process(hass, datetime.now(UTC))
        assert hass.data[DOMAIN]["maintenance_jobs"].get(identifier)["state"] == "verified"
        assert write.await_count == 1
