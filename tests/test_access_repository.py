"""Crash consistency, revision conflicts, ownership and deferred credential revocation."""

from copy import deepcopy
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.access.models import (
    AccessError,
    SecretValue,
    valid_period,
)
from custom_components.hikvision_intercom.access.repository import AccessRepository


@pytest.fixture
async def repo():
    repository = AccessRepository(AsyncMock())
    await repository.async_load(None)
    return repository


async def person(repo, **changes):
    return await repo.async_create(
        {
            "display_name": "Demo",
            "employee_no": "1001",
            "pin": "123456",
            "cards": [{"card_no": "000012345678", "label": "Office"}],
            "assignments": {
                "station-a": {"allowed_locks": [1]},
                "station-b": {"allowed_locks": [1]},
            },
            **changes,
        }
    )


async def test_private_roundtrip_and_masked_projection(repo):
    user = await person(repo)
    public = str(repo.public())
    assert "123456" not in public and "000012345678" not in public
    assert "5678" in public and "pin_configured" in public
    assert "123456" not in str(SecretValue("123456")) and "123456" not in repr(
        SecretValue("123456")
    )
    saved = repo.snapshot()
    restored = AccessRepository(AsyncMock())
    await restored.async_load(saved)
    assert restored.get(user.id).pin.value == "123456"
    assert restored.get(user.id).cards[0].card_no.value == "000012345678"
    saved["users"].clear()
    assert len(repo.users()) == 1


async def test_failed_persistence_does_not_publish_desired_state(repo):
    repo._save.side_effect = OSError("disk unavailable")
    with pytest.raises(OSError):
        await person(repo)
    assert not repo.users()


async def test_revision_and_secret_preservation_on_edit(repo):
    user = await person(repo)
    updated = await repo.async_update(
        user.id,
        {"display_name": "Renamed", "cards": [{"id": user.cards[0].id, "label": "New label"}]},
        expected_revision=1,
    )
    assert updated.revision == 2 and updated.pin == user.pin
    assert updated.cards[0].card_no == user.cards[0].card_no
    with pytest.raises(AccessError, match="revision_conflict"):
        await repo.async_update(user.id, {"pin": None}, expected_revision=1)
    assert repo.get(user.id).pin is not None


@pytest.mark.parametrize(
    ("change", "error"),
    [
        ({"employee_no": "1001", "pin": None, "cards": []}, "employee_conflict"),
        ({"employee_no": "1002", "cards": []}, "pin_conflict"),
        ({"employee_no": "1002", "pin": None}, "card_conflict"),
    ],
)
async def test_cross_person_collisions_rollback(repo, change, error):
    await person(repo)
    with pytest.raises(AccessError, match=error):
        await person(repo, **change)
    assert len(repo.users()) == 1


async def test_delete_survives_restart_and_keeps_secrets_until_all_confirm(repo):
    user = await person(repo)
    await repo.async_bind("station-a", user.id, fingerprint="observed", adopted=True)
    await repo.async_delete(user.id, expected_revision=1)
    assert not repo.users()
    assert "record" not in repo.public()["tombstones"][0]
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    await restored.async_confirm_absent("station-a", user.id)
    assert restored.snapshot()["tombstones"][user.id]["record"]["pin"] == "123456"
    await restored.async_confirm_absent("station-b", user.id)
    assert restored.snapshot()["tombstones"] == {}
    assert "123456" not in str(restored.snapshot())


async def test_identity_locks_before_first_write(repo):
    user = await person(repo)
    await repo.async_write_intent(
        "station-a",
        user.id,
        revision=1,
        expected_fingerprint=None,
        desired_fingerprint="planned",
        operation="create",
    )
    with pytest.raises(AccessError, match="identity_migration_required"):
        await repo.async_update(user.id, {"employee_no": "1002"}, expected_revision=1)
    assert repo.get(user.id).employee_no == "1001"


async def test_edit_during_sync_cannot_be_acknowledged_as_new_revision(repo):
    user = await person(repo)
    await repo.async_bind("station-a", user.id, fingerprint="before")
    updated = await repo.async_update(user.id, {"display_name": "New"}, expected_revision=1)
    await repo.async_record_observation(
        "station-a", user.id, fingerprint="old-write", applied_revision=1
    )
    assignment = repo.get(user.id).assignments["station-a"]
    assert assignment.desired_revision == updated.revision and assignment.applied_revision is None
    assert assignment.sync_state == "pending"
    with pytest.raises(AccessError, match="revision_conflict"):
        await repo.async_write_intent(
            "station-a",
            user.id,
            revision=1,
            expected_fingerprint="old-write",
            desired_fingerprint="new",
            operation="update",
        )


async def test_removed_card_reserved_until_offline_station_confirms(repo):
    user = await person(repo)
    await repo.async_update(user.id, {"cards": []}, expected_revision=1)
    with pytest.raises(AccessError, match="card_removal_pending"):
        await person(repo, employee_no="1002", pin=None)
    await repo.async_confirm_card_removals("station-a", user.id, set())
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    with pytest.raises(AccessError, match="card_removal_pending"):
        await person(restored, employee_no="1002", pin=None)
    await restored.async_confirm_card_removals("station-b", user.id, set())
    second = await person(restored, employee_no="1002", pin=None)
    assert second.cards[0].card_no.value == "000012345678"


async def test_syncing_is_visible_but_becomes_pending_after_restart(repo):
    user = await person(repo)
    await repo.async_mark("station-a", user.id, "syncing")
    assert repo.get(user.id).assignments["station-a"].sync_state == "syncing"
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    assert restored.get(user.id).assignments["station-a"].sync_state == "pending"


async def test_adoption_and_assignment_are_atomic(repo):
    user = await repo.async_adopt(
        "station-a",
        {"employee_no": "1001", "display_name": "Imported", "cards": []},
        fingerprint="device-snapshot",
    )
    saved = repo.snapshot()
    assert saved["users"][user.id]["assignments"]["station-a"]["enabled"]
    assert saved["bindings"]["station-a"][user.id]["adopted"]
    with pytest.raises(AccessError, match="already_managed"):
        await repo.async_adopt(
            "station-a",
            {"employee_no": "1001"},
            fingerprint="again",
            existing_user_id=user.id,
            expected_revision=1,
        )


@pytest.mark.parametrize(
    "change",
    [
        {"assignments": {"station": {"allowed_locks": [2]}}},
        {"assignments": {"station": {"allowed_locks": [True]}}},
        {"assignments": {"station": {"schedule_template": "65535"}}},
        {"pin": "not-numeric"},
        {"active": "false"},
        {"display_name": ""},
    ],
)
async def test_invalid_desired_state_cannot_be_persisted(repo, change):
    with pytest.raises(AccessError):
        await person(repo, **change)
    assert not repo.users()


@pytest.mark.parametrize(
    ("start", "end"),
    [
        ("2026-01-01T00:00:00", "2027-01-01T00:00:00"),
        ("2038-01-01T00:00:00Z", "2039-01-01T00:00:00Z"),
        ("2027-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    ],
)
def test_validity_requires_explicit_timezone_and_documented_range(start, end):
    with pytest.raises(AccessError):
        valid_period(start, end)


async def test_corrupt_storage_never_defaults_to_empty(repo):
    user = await person(repo)
    corrupted = deepcopy(repo.snapshot())
    corrupted["users"][user.id]["assignments"]["station-a"]["allowed_locks"] = [2]
    restored = AccessRepository(AsyncMock())
    with pytest.raises(AccessError):
        await restored.async_load(corrupted)


async def test_public_tombstone_projection_is_detached():
    repo = AccessRepository(AsyncMock())
    await repo.async_load(None)
    user = await repo.async_create(
        {"display_name": "Resident", "assignments": {"a": {"allowed_locks": [1]}}}
    )
    await repo.async_delete(user.id, expected_revision=1)
    public = repo.public()
    public["tombstones"][0]["confirmed"].append("a")
    public["tombstones"][0]["stations"]["a"]["sync_state"] = "synced"
    assert repo.public()["tombstones"][0]["confirmed"] == []
    assert repo.public()["tombstones"][0]["stations"]["a"]["sync_state"] == "delete_pending"
