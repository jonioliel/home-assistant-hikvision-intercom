"""Real auth/WebSocket lifecycle actions with mocked device transport."""

from copy import deepcopy
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.station_transactions_api import dispatch_lifecycle

from .test_operations_center import request
from .test_ordered_approvals import enable_approval, reviewer_client


async def prepared(client, source):
    result = await request(client, "platform/lifecycle_prepare", source_id=source, target_id="")
    assert result["success"], result
    return result["result"]["job"]


async def action(client, command, job, **values):
    return await request(
        client, command, job_id=job["id"], fingerprint=job["fingerprint"], confirmed=True, **values
    )


async def test_retirement_requires_apply_fresh_verification_and_explicit_connection_removal(
    hass, loaded_entry, hass_ws_client, hass_read_only_access_token, device_io
):
    manager = hass.data[DOMAIN]["access"]
    user = await manager.repository.async_create(
        {"display_name": "Retire safely", "assignments": {loaded_entry.entry_id: {"enabled": True}}}
    )
    client = await hass_ws_client(hass)
    device_io["write_person"].reset_mock()
    job = await prepared(client, loaded_entry.entry_id)
    assert manager.repository.get(user.id).assignments[loaded_entry.entry_id].enabled
    device_io["write_person"].assert_not_awaited()
    unconfirmed = await request(
        client,
        "platform/lifecycle_apply",
        job_id=job["id"],
        fingerprint=job["fingerprint"],
        confirmed=False,
    )
    assert unconfirmed["error"]["code"] == "confirmation_required"
    result = await action(client, "platform/lifecycle_apply", job)
    assert result["success"], result
    await hass.async_block_till_done()
    assert loaded_entry.entry_id not in manager.repository.get(user.id).assignments
    result = await action(client, "platform/lifecycle_verify", job)
    assert result["success"], result
    assert result["result"]["managed_access_cleanup_verified"]
    assert result["result"]["source_removal_ready"]
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    denied = await action(reader, "platform/lifecycle_remove", job)
    assert denied["error"]["code"] == "unauthorized"
    with patch.object(hass.config_entries, "async_remove", AsyncMock(return_value=True)) as remove:
        removed = await action(client, "platform/lifecycle_remove", job)
        assert removed["success"], removed
        assert removed["result"]["job"]["state"] == "removed"
        duplicate = await action(client, "platform/lifecycle_remove", job)
        assert duplicate["success"]
        remove.assert_awaited_once_with(loaded_entry.entry_id)
    device_io["unlock"].assert_not_awaited()
    device_io["write_person"].assert_not_awaited()


@pytest.mark.parametrize("revoked", [False, True])
async def test_second_approval_does_not_apply_and_current_second_admin_is_required(
    hass, loaded_entry, hass_ws_client, device_io, revoked
):
    client = await hass_ws_client(hass)
    await enable_approval(hass)
    job = await prepared(client, loaded_entry.entry_id)
    before = deepcopy(hass.data[DOMAIN]["access"].repository.snapshot()["users"])
    denied = await action(client, "platform/lifecycle_apply", job)
    assert denied["error"]["code"] == "approval_required"
    self_approval = await action(client, "platform/lifecycle_decide", job, approve=True)
    assert self_approval["error"]["code"] == "separate_approver_required"
    reviewer, second = await reviewer_client(hass, hass_ws_client)
    decision = await action(second, "platform/lifecycle_decide", job, approve=True)
    assert decision["success"], decision
    assert hass.data[DOMAIN]["access"].repository.snapshot()["users"] == before
    if revoked:
        await second.close()
        await hass.async_block_till_done()
        await hass.auth.async_update_user(reviewer, is_active=False)
    applied = await action(client, "platform/lifecycle_apply", job)
    assert applied["success"] is (not revoked), applied
    if revoked:
        assert applied["error"]["code"] == "unauthorized"
    device_io["unlock"].assert_not_awaited()


async def test_permission_revocation_during_fresh_read_does_not_persist_plan(
    hass, loaded_entry, hass_admin_user
):
    manager = hass.data[DOMAIN]["access"]
    before = manager.repository.snapshot()
    with patch.object(
        hass.auth,
        "async_get_user",
        AsyncMock(side_effect=[hass_admin_user, SimpleNamespace(is_active=False, is_admin=True)]),
    ):
        with pytest.raises(AccessError, match="unauthorized"):
            await dispatch_lifecycle(
                hass,
                "platform/lifecycle_prepare",
                {"source_id": loaded_entry.entry_id, "target_id": ""},
                hass_admin_user.id,
            )
    assert manager.repository.snapshot() == before


async def test_pending_owned_binding_cannot_be_removed_as_if_it_were_clean(
    hass, loaded_entry, hass_ws_client
):
    manager = hass.data[DOMAIN]["access"]
    client = await hass_ws_client(hass)
    job = await prepared(client, loaded_entry.entry_id)
    applied = await action(client, "platform/lifecycle_apply", job)
    assert applied["success"], applied
    await hass.async_block_till_done()
    user = await manager.repository.async_create({"display_name": "Reservation"})
    await manager.repository.async_bind(
        loaded_entry.entry_id, user.id, fingerprint="owned", adopted=True
    )
    with patch.object(hass.config_entries, "async_remove", AsyncMock()) as remove:
        denied = await action(client, "platform/lifecycle_remove", job)
    assert not denied["success"] and denied["error"]["code"] == "lifecycle_cleanup_pending"
    remove.assert_not_awaited()


async def test_dual_policy_enabled_after_apply_can_collect_separate_removal_consent(
    hass, loaded_entry, hass_ws_client
):
    client = await hass_ws_client(hass)
    job = await prepared(client, loaded_entry.entry_id)
    assert (await action(client, "platform/lifecycle_apply", job))["success"]
    await hass.async_block_till_done()
    await enable_approval(hass)
    saved = await request(client, "platform/lifecycle_jobs")
    assert saved["result"]["records"][0]["require_approval"]
    assert (await action(client, "platform/lifecycle_remove", job))["error"][
        "code"
    ] == "approval_required"
    _, second = await reviewer_client(hass, hass_ws_client)
    assert (await action(second, "platform/lifecycle_decide", job, approve=True))["success"]
    with patch.object(hass.config_entries, "async_remove", AsyncMock(return_value=True)) as remove:
        assert (await action(client, "platform/lifecycle_remove", job))["success"]
        remove.assert_awaited_once_with(loaded_entry.entry_id)


async def test_actual_connection_removal_unloads_runtime_without_holding_its_lane(
    hass, loaded_entry, hass_ws_client
):
    manager = hass.data[DOMAIN]["access"]
    client = await hass_ws_client(hass)
    job = await prepared(client, loaded_entry.entry_id)
    assert (await action(client, "platform/lifecycle_apply", job))["success"]
    await hass.async_block_till_done()
    removed = await action(client, "platform/lifecycle_remove", job)
    assert removed["success"], removed
    await hass.async_block_till_done()
    assert hass.config_entries.async_get_entry(loaded_entry.entry_id) is None
    assert loaded_entry.entry_id not in manager.stations
    assert manager.repository.snapshot()["station_lifecycles"][job["id"]]["state"] == "removed"


async def test_metadata_interruption_resumes_without_reapplying_permission_policy(
    hass, loaded_entry, hass_ws_client, hass_admin_user, device_io
):
    from pytest_homeassistant_custom_component.common import MockConfigEntry

    from .conftest import DATA, PROFILE

    target = MockConfigEntry(
        domain=DOMAIN,
        title="Replacement",
        unique_id="OTHER-SERIAL",
        data={**DATA, "host": "192.0.2.11"},
    )
    target.add_to_hass(hass)
    other = replace(PROFILE, unique_id="OTHER-SERIAL", serial="OTHER-SERIAL")
    with (
        patch(
            "custom_components.hikvision_intercom.client.client.HikvisionClient.async_profile",
            AsyncMock(return_value=other),
        ),
        patch(
            "custom_components.hikvision_intercom.client.client.HikvisionClient.async_device_info",
            AsyncMock(return_value=(other.unique_id, other.model, other.firmware, other.serial)),
        ),
    ):
        assert await hass.config_entries.async_setup(target.entry_id)
        await hass.async_block_till_done()
    manager = hass.data[DOMAIN]["access"]
    ops = hass.data[DOMAIN]["operations_center"]
    values = {
        "zone": "West",
        "owner": "Facilities",
        "tags": ["staff"],
        "thresholds": {"offline": 600, "sync_stalled": 900, "event_gap": 600},
        "window": {
            "enabled": False,
            "days": [],
            "start": "01:00",
            "end": "02:00",
            "timezone": "UTC",
        },
    }
    await ops.save_record("stations", loaded_entry.entry_id, 0, values, "fixture")
    client = await hass_ws_client(hass)

    # Read identity per host, without sending anything to a physical device.
    async def identity(driver):
        serial = "OTHER-SERIAL" if driver.settings.host == "192.0.2.11" else PROFILE.unique_id
        return serial, PROFILE.model, PROFILE.firmware, serial

    with patch(
        "custom_components.hikvision_intercom.client.client.HikvisionClient.async_device_info",
        identity,
    ):
        # Exercise the authenticated dispatcher directly here so failures retain
        # their traceback; subsequent mutations still use the real WebSocket.
        result = await dispatch_lifecycle(
            hass,
            "platform/lifecycle_prepare",
            {"source_id": loaded_entry.entry_id, "target_id": target.entry_id},
            hass_admin_user.id,
        )
        job = result["job"]
        original = ops.save_record
        with patch.object(ops, "save_record", AsyncMock(side_effect=OSError("disk unavailable"))):
            failed = await action(client, "platform/lifecycle_apply", job)
            assert not failed["success"]
        saved = manager.repository.snapshot()["station_lifecycles"][job["id"]]
        assert saved["state"] == "applied" and not saved["metadata_applied"]
        before = deepcopy(manager.repository.snapshot()["users"])
        with (
            patch.object(ops, "save_record", AsyncMock(wraps=original)) as save,
            patch.object(
                manager.repository,
                "async_lifecycle_mark",
                AsyncMock(side_effect=OSError("interrupted after metadata save")),
            ),
        ):
            interrupted = await action(client, "platform/lifecycle_apply", job)
            assert not interrupted["success"]
            save.assert_awaited_once()
        # The copy changed the global operations revision. Resume recognizes
        # the already-copied content and does not write or reapply policy again.
        with patch.object(ops, "save_record", AsyncMock(wraps=original)) as save:
            resumed = await action(client, "platform/lifecycle_apply", job)
            assert resumed["success"], resumed
            save.assert_not_awaited()
        assert manager.repository.snapshot()["users"] == before
        assert ops.data["stations"][target.entry_id]["values"] == values
        assert target.title == loaded_entry.title
    await hass.config_entries.async_unload(target.entry_id)
    await hass.async_block_till_done()
