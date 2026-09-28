"""Sensitive workflows cannot broaden access, skip revocation or approve themselves."""

import json
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.access.encrypted_backup import Backups, decrypt, encrypt
from custom_components.hikvision_intercom.access.manager import AccessManager
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.access.workflows import Workflows


@pytest.fixture
async def context():
    save = AsyncMock()
    repo = AccessRepository(save)
    await repo.async_load(None)
    manager = AccessManager(repo)
    manager.register("a", "Door", True)
    first = await repo.async_create(
        {
            "employee_no": "1001",
            "display_name": "Source",
            "pin": "726391",
            "cards": [{"card_no": "827361", "label": "Visitor"}],
            "assignments": {"a": {"allowed_locks": [1]}},
        }
    )
    second = await repo.async_create(
        {
            "employee_no": "1002",
            "display_name": "Target",
            "assignments": {"a": {"allowed_locks": [1]}},
        }
    )
    yield Workflows(manager), repo, save, first, second
    await manager.async_close()


def test_encryption_authenticates_randomized_content_and_password():
    snapshot = {"pin": "726391", "test": "private"}
    first = encrypt(snapshot, "long passphrase 123")
    second = encrypt(snapshot, "long passphrase 123")
    assert first != second and "726391" not in first
    assert decrypt(first, "long passphrase 123") == snapshot
    with pytest.raises(AccessError, match="backup_cannot_decrypt"):
        decrypt(first, "wrong password 1234")
    changed = json.loads(first)
    changed["data"] = "AAAA" + changed["data"][4:]
    with pytest.raises(AccessError, match="backup_cannot_decrypt"):
        decrypt(json.dumps(changed), "long passphrase 123")
    with pytest.raises(AccessError, match="passphrase"):
        encrypt(snapshot, "short")


async def test_backup_preview_is_read_only_and_collisions_block_apply(context):
    center, repo, _, first, _ = context
    backups = Backups(center.manager)
    snapshot = repo.snapshot()
    payload = encrypt(snapshot, "long passphrase 123")
    before = repo.snapshot()
    review = await backups.preview("owner", payload, "long passphrase 123", {}, "add_only")
    assert review["changed"] == 0 and repo.snapshot() == before
    # Update review goes stale after a local person changes; it cannot restore old PINs.
    review = await backups.preview("owner", payload, "long passphrase 123", {}, "update_matching")
    await repo.async_update(first.id, {"pin": "736492"}, expected_revision=first.revision)
    with pytest.raises(AccessError, match="csv_review_stale"):
        await backups.apply("owner", review["review_id"], True)
    assert repo.get(first.id).pin.value == "736492"


async def test_two_person_approval_requires_separate_actor_and_exact_snapshot(context):
    center, repo, _, first, _ = context
    change = {"user_id": first.id, "revision": first.revision, "data": {"active": False}}
    request = await center.submit("owner", [change], repo.bulk_stamp(), "Disable source")
    assert repo.get(first.id).active and "726391" not in json.dumps(request)
    with pytest.raises(AccessError, match="separate_approver_required"):
        await center.decide("owner", request["id"], True)
    await center.decide("reviewer", request["id"], True)
    with pytest.raises(AccessError, match="operation_not_found"):
        await center.apply_approval("reviewer", request["id"])
    result = await center.apply_approval("owner", request["id"])
    assert result["changed"] == 1 and not repo.get(first.id).active
    assert (await center.apply_approval("owner", request["id"]))["replayed"]


async def test_approval_stale_or_failed_save_does_not_apply(context):
    center, repo, save, first, second = context
    request = await center.submit(
        "owner",
        [{"user_id": first.id, "revision": first.revision, "data": {"active": False}}],
        repo.bulk_stamp(),
        "Disable",
    )
    await center.decide("reviewer", request["id"], True)
    await repo.async_update(
        second.id, {"display_name": "Changed"}, expected_revision=second.revision
    )
    with pytest.raises(AccessError, match="bulk_review_stale"):
        await center.apply_approval("owner", request["id"])
    assert repo.get(first.id).active
    before = repo.snapshot()
    save.side_effect = OSError
    with pytest.raises(OSError):
        await center.update_settings(
            0, {"idle_minutes": 5, "reauth_sensitive": True, "dual_approval": True}
        )
    assert repo.snapshot() == before


async def test_card_transfer_waits_for_all_device_revocations(context):
    center, repo, _, first, second = context
    # Simulate authoritative ownership observed on the device.
    await repo._commit(
        lambda state: state["bindings"].update(
            {
                "a": {
                    first.id: {
                        "employee_no": first.employee_no,
                        "cards": ["827361"],
                        "pin": "726391",
                    }
                }
            }
        )
    )
    transfer = await center.transfer_start(
        "owner", "card", first.id, second.id, first.revision, first.cards[0].id
    )
    assert not repo.get(first.id).cards and not repo.get(second.id).cards
    assert not transfer["ready"] and "827361" not in json.dumps(transfer)
    with pytest.raises(AccessError, match="revocation_not_confirmed"):
        await center.transfer_finish("owner", transfer["id"])
    await repo._commit(lambda state: state["retired_cards"].clear())
    result = await center.transfer_finish("owner", transfer["id"])
    assert result["completed"] and repo.get(second.id).cards[0].card_no.value == "827361"
    assert not repo.get(first.id).cards


async def test_transfer_target_change_blocks_late_assignment(context):
    center, repo, _, first, second = context
    transfer = await center.transfer_start(
        "owner", "card", first.id, second.id, first.revision, first.cards[0].id
    )
    await repo._commit(lambda state: state["retired_cards"].clear())
    await repo.async_update(
        second.id, {"display_name": "Changed target"}, expected_revision=second.revision
    )
    with pytest.raises(AccessError, match="revision_conflict"):
        await center.transfer_finish("owner", transfer["id"])
    assert not repo.get(second.id).cards


async def test_identity_migration_never_creates_second_live_identity(context):
    center, repo, _, first, _ = context
    transfer = await center.transfer_start(
        "owner", "identity", first.id, "", first.revision, "1003"
    )
    assert first.id not in repo.snapshot()["users"]
    with pytest.raises(AccessError, match="revocation_not_confirmed"):
        await center.transfer_finish("owner", transfer["id"])
    await repo._commit(lambda state: state["tombstones"].clear())
    result = await center.transfer_finish("owner", transfer["id"])
    assert repo.get(result["user_id"]).employee_no == "1003"
    assert repo.get(result["user_id"]).pin.value == "726391"


async def test_inventory_lost_is_revocation_not_only_a_label(context):
    center, repo, _, first, _ = context
    result = await center.inventory_save(
        "", 0, {"card_no": "827361", "label": "Visitor", "status": "lost", "return_by": None}
    )
    assert not repo.get(first.id).cards
    assert result["status"] == "lost" and "827361" not in json.dumps(result)
    with pytest.raises(AccessError, match="card_unavailable"):
        await center.inventory_issue(result["id"], first.id, repo.get(first.id).revision)


async def test_templates_contain_no_pin_and_apply_no_access_automatically(context):
    center, repo, _, _, _ = context
    before = deepcopy(repo.snapshot()["users"])
    template = await center.template_save(
        "",
        0,
        {
            "label": "Staff",
            "data": {"assignments": {"a": {"allowed_locks": [1]}}, "group_ids": []},
            "message": "Welcome {name}",
        },
    )
    assert template["revision"] == 1 and repo.snapshot()["users"] == before
    with pytest.raises(AccessError, match="invalid_fields"):
        await center.template_save(
            "", 0, {"label": "Unsafe", "data": {"pin": "726391"}, "message": ""}
        )
    await center.template_delete(template["id"], 1)
    assert not center.data["templates"]


async def test_inventory_edit_reuses_secret_and_block_cannot_be_bypassed(context):
    center, repo, _, first, _ = context
    row = await center.inventory_save(
        "", 0, {"card_no": "827361", "label": "Original", "status": "temporary", "return_by": None}
    )
    row = await center.inventory_save(
        row["id"],
        row["revision"],
        {"card_no": "", "label": "Lost", "status": "lost", "return_by": None},
    )
    assert row["label"] == "Lost" and not repo.get(first.id).cards
    with pytest.raises(AccessError, match="card_unavailable"):
        await repo.async_update(
            first.id,
            {"cards": [{"card_no": "827361"}]},
            expected_revision=repo.get(first.id).revision,
        )
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    assert restored.snapshot()["workflows"]["inventory"] == center.data["inventory"]


async def test_dual_approval_transfer_does_not_revoke_before_review(context):
    center, repo, _, first, second = context
    await center.update_settings(
        0, {"idle_minutes": 0, "reauth_sensitive": False, "dual_approval": True}
    )
    row = await center.transfer_start(
        "owner", "card", first.id, second.id, first.revision, first.cards[0].id
    )
    assert row["state"] == "awaiting_approval" and repo.get(first.id).cards
    with pytest.raises(AccessError, match="separate_approver_required"):
        await center.transfer_review("owner", row["id"], True)
    await center.transfer_review("reviewer", row["id"], True)
    assert repo.get(first.id).cards
    await center.transfer_begin("owner", row["id"])
    assert not repo.get(first.id).cards
    with pytest.raises(AccessError, match="revocation_not_confirmed"):
        await center.transfer_finish("owner", row["id"])
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    assert restored.snapshot()["workflows"]["transfers"] == center.data["transfers"]


async def test_inventory_change_and_revocation_approve_in_one_transaction(context):
    center, repo, save, first, _ = context
    changes, effects = center.inventory_review(
        "", 0, {"card_no": "827361", "label": "Lost card", "status": "lost", "return_by": None}
    )
    request = await center.submit("owner", changes, repo.bulk_stamp(), "Block lost card", effects)
    assert repo.get(first.id).cards and not center.data["inventory"]
    assert "827361" not in json.dumps(request)
    await center.decide("reviewer", request["id"], True)
    before = repo.snapshot()
    save.side_effect = OSError("disk unavailable")
    with pytest.raises(OSError):
        await center.apply_approval("owner", request["id"])
    assert repo.snapshot() == before
    save.side_effect = None
    await center.apply_approval("owner", request["id"])
    assert not repo.get(first.id).cards and center.inventory()[0]["status"] == "lost"


async def test_approval_can_be_withdrawn_without_changing_access(context):
    center, repo, _, first, _ = context
    request = await center.submit(
        "owner",
        [{"user_id": first.id, "revision": first.revision, "data": {"active": False}}],
        repo.bulk_stamp(),
        "Disable",
    )
    with pytest.raises(AccessError, match="operation_not_found"):
        await center.withdraw("reviewer", request["id"])
    await center.withdraw("owner", request["id"])
    assert repo.get(first.id).active and center.data["approvals"][request["id"]]["changes"] == []


async def test_backup_preserves_explicit_exceptions_and_lock_two_and_replays(context):
    center, repo, _, first, _ = context
    from custom_components.hikvision_intercom.profile_settings import ProfileSettings

    profiles = ProfileSettings(repo.async_profile_settings, lambda: None, repo.profile_settings)
    await profiles.update(
        0,
        {
            "photo_enabled": False,
            "fields": [],
            "groups": [{"id": "staff", "label": "Staff", "enabled": True, "station_ids": ["a"]}],
            "templates": [],
        },
    )
    person = await repo.async_update(
        first.id,
        {
            "group_ids": ["staff"],
            "permission_overrides": {"a": "allow"},
            "door_permissions": {"a": [1, 2]},
        },
        expected_revision=first.revision,
    )
    from custom_components.hikvision_intercom.access.encrypted_backup import desired

    planned = desired(person, {})
    assert planned["permission_overrides"] == {"a": "allow"}
    assert planned["door_permissions"] == {"a": [1, 2]}
    backups = Backups(center.manager)
    payload = encrypt(repo.snapshot(), "long passphrase 123")
    review = await backups.preview("owner", payload, "long passphrase 123", {}, "update_matching")
    assert review["errors"] == 0
    await backups.apply("owner", review["review_id"], True)
    assert (await backups.apply("owner", review["review_id"], True))["replayed"]
    assert repo.get(first.id).assignments["a"].allowed_locks == {1, 2}
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    assert restored.get(first.id).permission_overrides == {"a": "allow"}


async def test_reminders_and_renewals_never_send_and_require_other_reviewer(context):
    center, repo, _, first, _ = context
    now = datetime.now(UTC)
    person = await repo.async_update(
        first.id,
        {
            "valid_from": (now - timedelta(days=1)).isoformat(),
            "valid_until": (now + timedelta(days=1)).isoformat(),
        },
        expected_revision=first.revision,
    )
    reminders = center.reminders()
    assert len(reminders) == 1 and reminders[0]["kind"] == "expires"
    await center.reminder_action("owner", reminders[0]["id"], "acknowledge")
    assert not center.reminders()
    request = await center.renewal_request(
        "operator",
        person.id,
        person.revision,
        (now + timedelta(days=2)).isoformat(),
        "Extend assignment",
    )
    with pytest.raises(AccessError, match="separate_approver_required"):
        await center.renewal_decide("operator", request["id"], True)
    await center.renewal_decide("owner", request["id"], True)
    assert repo.get(person.id).revision == person.revision + 1


async def test_workflow_records_survive_restart_without_replaying(context):
    center, repo, _, first, _ = context
    await center.submit(
        "owner",
        [{"user_id": first.id, "revision": first.revision, "data": {"active": False}}],
        repo.bulk_stamp(),
        "Disable",
    )
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    assert (
        restored.get(first.id).active
        and restored.snapshot()["workflows"] == repo.snapshot()["workflows"]
    )
