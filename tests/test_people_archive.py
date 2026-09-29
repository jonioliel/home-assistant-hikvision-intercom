"""Archive preserves identity and cleanup; restoration never silently enables access."""

from copy import deepcopy
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.access.admin_audit import audit_actor
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.access.user_directory import query_users


@pytest.fixture
async def repo():
    value = AccessRepository(AsyncMock())
    await value.async_load(None)
    return value


async def person(repo):
    return await repo.async_create(
        {
            "display_name": "Archived person",
            "pin": "928371",
            "cards": [{"card_no": "000077779999"}],
            "phone": "0501234567",
            "assignments": {"offline-station": {"allowed_locks": [1, 2]}},
        }
    )


async def test_archive_preserves_identity_and_cleanup_restore_stays_inactive(
    repo,
):
    old = await person(repo)
    await repo.async_bind("offline-station", old.id, fingerprint="owned", adopted=True)
    updated = await repo.async_update(
        old.id, {"pin": "817263", "cards": []}, expected_revision=old.revision
    )
    pending = deepcopy(repo.snapshot())
    with audit_actor("admin", "users/archive"):
        archived = await repo.async_archive(
            old.id, expected_revision=updated.revision, archived=True
        )
    assert archived.archived_at and not archived.active
    for key in ("bindings", "retired_pins", "retired_cards", "tombstones"):
        assert repo.snapshot()[key] == pending[key]
    for key in (
        "employee_no",
        "display_name",
        "pin",
        "cards",
        "phone",
        "permission_overrides",
        "group_ids",
    ):
        assert archived.private()[key] == updated.private()[key]
    assert archived.assignments["offline-station"].allowed_locks == frozenset({1, 2})
    assert archived.assignments["offline-station"].sync_state == "pending"
    assert repo.snapshot()["admin_audit"]["records"][-1]["action"] == "users/archive"
    restored_store = AccessRepository(AsyncMock())
    await restored_store.async_load(repo.snapshot())
    with audit_actor("admin", "users/unarchive"):
        restored = await restored_store.async_archive(
            old.id, expected_revision=archived.revision, archived=False
        )
    assert restored.archived_at is None and not restored.active
    assert restored_store.snapshot()["retired_pins"] == pending["retired_pins"]
    assert restored_store.snapshot()["retired_cards"] == pending["retired_cards"]
    assert restored_store.snapshot()["admin_audit"]["records"][-1]["action"] == "users/unarchive"
    assert restored_store.get(old.id).employee_no == old.employee_no


@pytest.mark.parametrize("path", ["direct", "bulk"])
async def test_archived_identity_cannot_be_reenabled_through_general_updates(repo, path):
    old = await person(repo)
    archived = await repo.async_archive(old.id, expected_revision=old.revision, archived=True)
    before = repo.snapshot()
    with pytest.raises(AccessError, match="user_archived"):
        if path == "direct":
            await repo.async_update(old.id, {"active": True}, expected_revision=archived.revision)
        else:
            repo.preview_bulk(
                [{"user_id": old.id, "revision": archived.revision, "data": {"active": True}}]
            )
    assert repo.snapshot() == before


async def test_archive_commit_failure_and_stale_revision_leave_all_state_intact(repo):
    old = await person(repo)
    before = repo.snapshot()
    with pytest.raises(AccessError, match="revision_conflict"):
        await repo.async_archive(old.id, expected_revision=old.revision + 1, archived=True)
    assert repo.snapshot() == before
    repo._save = AsyncMock(side_effect=OSError("storage unavailable"))
    with pytest.raises(OSError):
        await repo.async_archive(old.id, expected_revision=old.revision, archived=True)
    assert repo.snapshot() == before


async def test_archive_retains_unique_pin_reservation_and_repeated_state_is_rejected(repo):
    old = await person(repo)
    archived = await repo.async_archive(old.id, expected_revision=old.revision, archived=True)
    assert not repo.pin_available("928371")
    with pytest.raises(AccessError, match="archive_state_changed"):
        await repo.async_archive(old.id, expected_revision=archived.revision, archived=True)


@pytest.mark.parametrize("malformed", ["active", "naive", "invalid"])
async def test_invalid_archive_storage_fails_closed(repo, malformed):
    old = await person(repo)
    await repo.async_archive(old.id, expected_revision=old.revision, archived=True)
    saved = repo.snapshot()
    if malformed == "active":
        saved["users"][old.id]["active"] = True
    else:
        saved["users"][old.id]["archived_at"] = (
            "2026-09-29T00:00:00" if malformed == "naive" else "yesterday"
        )
    restored = AccessRepository(AsyncMock())
    with pytest.raises(AccessError):
        await restored.async_load(saved)
    assert restored.users() == []


async def test_directory_hides_archives_by_default_and_requires_explicit_archive_filter(repo):
    old = await person(repo)
    await repo.async_archive(old.id, expected_revision=old.revision, archived=True)
    await repo.async_create({"display_name": "Current person"})

    def query(filters):
        return query_users(
            repo.public()["users"], query="", filters=filters, offset=0, limit=25, snapshot=""
        )

    assert [u["display_name"] for u in query({})["records"]] == ["Current person"]
    assert query({"state": "inactive"})["records"] == []
    archived = query({"state": "archived"})
    assert archived["total"] == 1 and archived["records"][0]["id"] == old.id
    assert not archived["records"][0]["active"]


async def test_schema14_migrates_old_audit_without_erasing_identity(repo):
    old = await person(repo)
    with audit_actor("admin", "users/update"):
        await repo.async_update(
            old.id, {"display_name": "Before upgrade"}, expected_revision=old.revision
        )
    saved = repo.snapshot()
    saved["schema"] = 14
    for raw in saved["users"].values():
        raw.pop("archived_at")
    for entry in saved["admin_audit"]["records"]:
        for side in ("before", "after"):
            if entry[side]:
                entry[side].pop("archived_at", None)
    restored = AccessRepository(AsyncMock())
    await restored.async_load(saved)
    assert restored.snapshot()["schema"] == 15
    assert restored.get(old.id).archived_at is None
    assert restored.snapshot()["admin_audit"]["records"] == saved["admin_audit"]["records"]


async def test_dual_review_preserves_archive_intent_and_pending_bindings(repo):
    from custom_components.hikvision_intercom.access.manager import AccessManager
    from custom_components.hikvision_intercom.access.workflows import Workflows

    old = await person(repo)
    await repo.async_bind("offline-station", old.id, fingerprint="owned", adopted=True)
    manager = AccessManager(repo)
    center = Workflows(manager)
    changes = [
        {"user_id": old.id, "revision": old.revision, "data": {"active": False}, "archive": True}
    ]
    request = await center.submit("owner", changes, repo.bulk_stamp(), "Archive person")
    assert repo.get(old.id).active and not repo.get(old.id).archived_at
    assert "archived_at" in request["people"][0]["fields"]
    await center.decide("reviewer", request["id"], True)
    before_bindings = deepcopy(repo.snapshot()["bindings"])
    await center.apply_approval("owner", request["id"])
    assert repo.get(old.id).archived_at and not repo.get(old.id).active
    assert repo.snapshot()["bindings"] == before_bindings
    assert (await center.apply_approval("owner", request["id"]))["replayed"]
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    assert restored.get(old.id).archived_at
    await manager.async_close()


async def test_encrypted_desired_import_does_not_recreate_archived_identities(repo):
    from custom_components.hikvision_intercom.access.encrypted_backup import Backups, encrypt
    from custom_components.hikvision_intercom.access.manager import AccessManager

    old = await person(repo)
    await repo.async_archive(old.id, expected_revision=old.revision, archived=True)
    target = AccessRepository(AsyncMock())
    await target.async_load(None)
    manager = AccessManager(target)
    backups = Backups(manager)
    review = await backups.preview(
        "owner",
        encrypt(repo.snapshot(), "long archive password"),
        "long archive password",
        {},
        "add_only",
    )
    assert review["rows"][0]["action"] == "skip" and review["changed"] == 0
    await backups.apply("owner", review["review_id"], True)
    assert target.users() == []
    await manager.async_close()
