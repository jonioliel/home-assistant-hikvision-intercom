"""Cancellation is an atomic disable intent, including offline targets and audit evidence."""

import asyncio
from copy import deepcopy
from unittest.mock import AsyncMock, patch

import pytest

from custom_components.hikvision_intercom.access.admin_audit import audit_actor
from custom_components.hikvision_intercom.access.manager import AccessManager
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.repository import AccessRepository


@pytest.fixture
async def repo():
    repository = AccessRepository(AsyncMock())
    await repository.async_load(None)
    return repository


async def visitor(repo, **extra):
    return await repo.async_create(
        {
            "employee_no": "4815",
            "display_name": "Temporary visitor",
            "access_category": "visitor",
            "responsible_person": "Reception",
            "access_purpose": "Service",
            "phone": "050-123-4567",
            "pin": "843297",
            "cards": [{"card_no": "000099887766"}],
            "valid_from": "2026-09-28T00:00:00+00:00",
            "valid_until": "2026-09-29T00:00:00+00:00",
            "assignments": {"a": {"allowed_locks": [1, 2]}, "b": {"allowed_locks": [1]}},
            **extra,
        }
    )


@pytest.mark.parametrize("category", ["visitor", "contractor"])
@pytest.mark.parametrize(
    "reason", ["visit_cancelled", "visit_completed", "access_no_longer_needed"]
)
async def test_cancel_preserves_credentials_doors_and_records_reason_after_restart(
    repo, category, reason
):
    user = await visitor(repo, access_category=category)
    previous = user.private()
    with audit_actor("operator-id", "users/temporary_cancel", reason_code=reason):
        cancelled = await repo.async_cancel_temporary(user.id, expected_revision=user.revision)
    assert not cancelled.active
    for key in (
        "pin",
        "cards",
        "valid_from",
        "valid_until",
        "responsible_person",
        "access_purpose",
        "phone",
        "permission_overrides",
        "access_timing_policy",
    ):
        assert cancelled.private()[key] == previous[key]
    assert set(cancelled.assignments) == {"a", "b"}
    assert cancelled.assignments["a"].allowed_locks == frozenset({1, 2})
    assert all(item.sync_state == "pending" for item in cancelled.assignments.values())
    audit = repo.snapshot()["admin_audit"]["records"][-1]
    assert audit["action"] == "users/temporary_cancel"
    assert audit["actor"] == "operator-id" and audit["reason_code"] == reason
    assert audit["fields"] == ["active"]
    assert "843297" not in str(audit) and "000099887766" not in str(audit)
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    assert not restored.get(user.id).active
    assert restored.snapshot()["admin_audit"]["records"][-1] == audit


async def test_cancel_rejects_stale_revision_staff_and_duplicate_request(repo):
    staff = await visitor(repo, access_category="staff")
    with pytest.raises(AccessError, match="temporary_user_required"):
        await repo.async_cancel_temporary(staff.id, expected_revision=staff.revision)
    with pytest.raises(AccessError, match="revision_conflict"):
        await repo.async_cancel_temporary(staff.id, expected_revision=True)
    guest = await visitor(repo, employee_no="4816", pin="843298", cards=[])
    changed = await repo.async_update(
        guest.id, {"access_purpose": "Changed"}, expected_revision=guest.revision
    )
    with pytest.raises(AccessError, match="revision_conflict"):
        await repo.async_cancel_temporary(guest.id, expected_revision=guest.revision)
    cancelled = await repo.async_cancel_temporary(guest.id, expected_revision=changed.revision)
    before = repo.snapshot()
    with pytest.raises(AccessError, match="temporary_already_inactive"):
        await repo.async_cancel_temporary(guest.id, expected_revision=cancelled.revision)
    assert repo.snapshot() == before


async def test_save_failure_keeps_active_record_and_has_no_audit_or_sync_request(repo):
    user = await visitor(repo)
    manager = AccessManager(repo)
    before = repo.snapshot()
    repo._save.side_effect = OSError("Synthetic persistence failure")
    with patch.object(manager, "request_user") as queued:
        with audit_actor("operator", "users/temporary_cancel", reason_code="visit_cancelled"):
            with pytest.raises(OSError):
                await manager.async_cancel_temporary(user.id, revision=user.revision)
        queued.assert_not_called()
    assert repo.snapshot() == before
    await manager.async_close()


async def test_offline_cancellation_queues_existing_sync_without_device_reads(repo):
    user = await visitor(repo)
    manager = AccessManager(repo)
    manager.register("a", "Front", True)
    manager.register("b", "Back", True)
    with patch.object(manager, "request_user") as queued:
        result = await manager.async_cancel_temporary(user.id, revision=user.revision)
        queued.assert_called_once_with(user.id)
    assert not result["active"]
    assert result["assignments"]["b"]["sync_state"] == "pending"
    await manager.async_close()


async def test_concurrent_edit_and_cancel_cannot_overwrite_each_other(repo):
    user = await visitor(repo)
    results = await asyncio.gather(
        repo.async_cancel_temporary(user.id, expected_revision=user.revision),
        repo.async_update(
            user.id, {"access_purpose": "Later change"}, expected_revision=user.revision
        ),
        return_exceptions=True,
    )
    assert sum(isinstance(result, AccessError) for result in results) == 1
    assert (
        next(result for result in results if isinstance(result, AccessError)).code
        == "revision_conflict"
    )
    assert repo.get(user.id).revision == user.revision + 1


async def test_reason_cannot_be_spoofed_as_arbitrary_text_or_inherited_by_worker(repo):
    with pytest.raises(AccessError, match="invalid_fields"):
        with audit_actor("operator", "users/temporary_cancel", reason_code="847291 secret"):
            pass
    with pytest.raises(AccessError, match="invalid_fields"):
        with audit_actor("operator", "users/update", reason_code="visit_cancelled"):
            pass
    user = await visitor(repo)
    with audit_actor("operator", "users/temporary_cancel", reason_code="visit_cancelled"):
        await asyncio.create_task(
            repo.async_cancel_temporary(user.id, expected_revision=user.revision)
        )
    row = repo.snapshot()["admin_audit"]["records"][-1]
    assert row["actor"] == "" and row["action"] == "system" and "reason_code" not in row
    invalid = deepcopy(repo.snapshot())
    invalid["admin_audit"]["records"][-1]["reason_code"] = "visit_cancelled"
    with pytest.raises(AccessError, match="invalid_storage"):
        await AccessRepository(AsyncMock()).async_load(invalid)
