# ruff: noqa: F811
"""Compatibility, durable intent and repeatable multi-failure acceptance tests."""

from copy import deepcopy
from datetime import UTC, datetime, timedelta
from random import Random
from unittest.mock import AsyncMock

import pytest
from test_access_engine import create_user, setup  # noqa: F401

from custom_components.hikvision_intercom import api_contract
from custom_components.hikvision_intercom.access.engine import SyncEngine
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.access.sync_tracking import pending_age
from custom_components.hikvision_intercom.exceptions import HikvisionConnectionError


@pytest.mark.parametrize("version", [0, 1])
def test_supported_clients(version):
    api_contract.validate_client(version, command="users/update")


@pytest.mark.parametrize("version", [-1, 2, True, "1", None])
def test_incompatible_writes_rejected_but_read_and_cancel_remain(version):
    with pytest.raises(AccessError, match="api_incompatible"):
        api_contract.validate_client(version, command="users/delete")
    api_contract.validate_client(version, command="overview")
    api_contract.validate_client(version, command="cards/capture_cancel")


def test_future_backend_rejects_legacy_write_without_blocking_read(monkeypatch):
    monkeypatch.setattr(api_contract, "MIN_CLIENT", 2)
    with pytest.raises(AccessError):
        api_contract.validate_client(command="users/update")
    api_contract.validate_client(command="overview")


async def test_operation_survives_retry_restart_and_local_contact_edit(setup):
    repo, device, driver, engine = setup
    user = await create_user(repo)
    original = repo.public()["sync_operations"][0]
    saved = repo.snapshot()
    saved["sync_operations"][f"{user.id}/a"]["queued_at"] = (
        datetime.now(UTC) - timedelta(minutes=5)
    ).isoformat()
    restored = AccessRepository(AsyncMock())
    await restored.async_load(saved)
    assert 299 <= pending_age(restored.snapshot(), "a") <= 302
    await restored.async_mark("a", user.id, "offline")
    await restored.async_update(user.id, {"phone": "0501234567"}, expected_revision=1)
    operation = restored.public()["sync_operations"][0]
    assert operation["id"] == original["id"]
    assert operation["queued_at"] == saved["sync_operations"][f"{user.id}/a"]["queued_at"]
    await SyncEngine(restored).async_reconcile("a", driver)
    assert restored.public()["sync_operations"][0]["state"] == "verified"
    assert pending_age(restored.snapshot(), "a") == 0


async def test_stations_are_tracked_independently_and_lost_ack_is_not_verified(setup):
    repo, device, driver, engine = setup
    await create_user(repo, assignments={"a": {"allowed_locks": [1]}, "b": {"allowed_locks": [1]}})
    device.fail_after = ("UserInfo", "Record")
    await engine.async_reconcile("a", driver)
    assert all(op["verified_at"] is None for op in repo.public()["sync_operations"])
    await engine.async_reconcile("a", driver)
    operations = {op["station_id"]: op for op in repo.public()["sync_operations"]}
    assert operations["a"]["state"] == "verified" and operations["b"]["state"] == "pending"
    assert operations["a"]["id"] != operations["b"]["id"]
    assert "123456" not in str(operations) and "intent" not in str(operations)


@pytest.mark.parametrize("seed", range(8))
async def test_seeded_edit_revoke_restart_and_missing_ack_never_resurrect_access(setup, seed):
    repo, device, driver, engine = setup
    random = Random(seed)
    user = await create_user(repo)
    await engine.async_reconcile("a", driver)
    for step in range(4):
        current = repo.get(user.id)
        await repo.async_update(
            user.id, {"display_name": f"Edit {seed}-{step}"}, expected_revision=current.revision
        )
        device.fail_after = ("UserInfo", "Modify") if random.choice([True, False]) else None
        await SyncEngine(repo).async_reconcile("a", driver)
        restored = AccessRepository(AsyncMock())
        await restored.async_load(repo.snapshot())
        repo = restored
    device.offline = True
    current = repo.get(user.id)
    await repo.async_update(user.id, {"assignments": {}}, expected_revision=current.revision)
    with pytest.raises(HikvisionConnectionError):
        await SyncEngine(repo).async_reconcile("a", driver)
    saved = deepcopy(repo.snapshot())
    repo = AccessRepository(AsyncMock())
    await repo.async_load(saved)
    assert not repo.get(user.id).assignments
    device.offline = False
    device.fail_after = ("UserInfo", "Delete")
    await SyncEngine(repo).async_reconcile("a", driver)
    restarted = AccessRepository(AsyncMock())
    await restarted.async_load(repo.snapshot())
    await SyncEngine(restarted).async_reconcile("a", driver)
    assert user.employee_no not in device.users
    assert not device.cards
    assert restarted.public()["sync_operations"][0]["state"] == "verified"
    writes = len(device.writes)
    await SyncEngine(restarted).async_reconcile("a", driver)
    assert len(device.writes) == writes


@pytest.mark.parametrize("schema", range(1, 8))
async def test_all_released_schemas_migrate_atomically_and_keep_unknown_age(schema):
    repo = AccessRepository(AsyncMock())
    user = await create_user(repo)
    raw = repo.snapshot()
    raw.pop("sync_operations")
    raw["schema"] = schema
    if schema < 5:
        raw.pop("profile_settings")
    if schema < 3:
        raw.pop("admin_audit")
        raw.pop("operation_receipts")
    if schema < 2:
        raw.pop("retired_pins")
    original = deepcopy(raw)
    save = AsyncMock(side_effect=OSError("disk full"))
    restored = AccessRepository(save)
    with pytest.raises(OSError):
        await restored.async_load(raw)
    assert restored.users() == [] and raw == original
    save.side_effect = None
    await restored.async_load(raw)
    assert restored.get(user.id).pin.value == user.pin.value
    assert restored.get(user.id).cards[0].card_no == user.cards[0].card_no
    assert restored.snapshot()["schema"] == 10
    assert pending_age(restored.snapshot(), "a") is None
    operation = restored.public()["sync_operations"][0]
    assert operation["queued_at"] is None
    roundtrip = AccessRepository(AsyncMock())
    await roundtrip.async_load(restored.snapshot())
    assert roundtrip.public()["sync_operations"] == restored.public()["sync_operations"]


async def test_tracking_write_failure_does_not_publish_operation(setup):
    repo, *_ = setup
    repo._save.side_effect = OSError("disk")
    with pytest.raises(OSError):
        await create_user(repo)
    assert not repo.public()["sync_operations"]


async def test_repeated_absence_readback_does_not_rewrite_completed_operation(setup, monkeypatch):
    repo, device, driver, engine = setup
    await create_user(repo, active=False)
    await engine.async_reconcile("a", driver)
    operation = deepcopy(repo.public()["sync_operations"])
    calls = repo._save.await_count
    monkeypatch.setattr(
        "custom_components.hikvision_intercom.access.sync_tracking.utc_now",
        lambda: "2030-01-01T00:00:00+00:00",
    )
    await engine.async_reconcile("a", driver)
    assert repo.public()["sync_operations"] == operation
    assert repo._save.await_count == calls


async def test_schema_seven_preserves_photo_groups_exceptions_and_revocations():
    from test_profiles import PHOTO

    from custom_components.hikvision_intercom.profile_settings import ProfileSettings

    repo = AccessRepository(AsyncMock())
    policy = ProfileSettings(repo.async_profile_settings, lambda: None, repo.profile_settings)
    await policy.update(
        0,
        {
            "photo_enabled": True,
            "fields": [{"id": "department", "label": "Department", "enabled": True, "options": []}],
            "groups": [
                {"id": "staff", "label": "Staff", "enabled": True, "station_ids": ["a", "b"]}
            ],
        },
    )
    user = await repo.async_create(
        {
            "display_name": "Resident",
            "employee_no": "1001",
            "phone": "0501234567",
            "photo": PHOTO,
            "profile": {"department": "Operations"},
            "group_ids": ["staff"],
            "permission_overrides": {"b": "deny"},
            "pin": "847291",
            "cards": [{"card_no": "000011112222"}],
        }
    )
    await repo.async_bind("a", user.id, fingerprint="observed", adopted=True)
    user = await repo.async_update(
        user.id, {"pin": None, "cards": []}, expected_revision=user.revision
    )
    backup = repo.snapshot()
    backup["schema"] = 7
    backup.pop("sync_operations")
    original = deepcopy(backup)
    restored = AccessRepository(AsyncMock())
    await restored.async_load(backup)
    assert backup == original
    assert restored.get(user.id).private() == user.private()
    assert restored.get(user.id).photo == PHOTO
    assert restored.get(user.id).assignments["a"].enabled
    assert (
        not restored.get(user.id).assignments.get("b")
        or not restored.get(user.id).assignments["b"].enabled
    )
    for key in ("bindings", "retired_cards", "retired_pins", "profile_settings"):
        assert restored.snapshot()[key] == backup[key]
    assert restored.snapshot()["retired_pins"] and restored.snapshot()["retired_cards"]
