"""Host approval is atomic, bound to an unchanged guest and cannot bypass activation."""

import asyncio
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, Mock, patch

import pytest

from custom_components.hikvision_intercom.access.admin_audit import audit_actor
from custom_components.hikvision_intercom.access.manager import AccessManager
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.repository import AccessRepository


def data(**patch_values):
    now = datetime.now(UTC)
    return {
        "display_name": "Guest",
        "active": False,
        "access_category": "visitor",
        "responsible_person": "Facilities",
        "access_purpose": "Maintenance",
        "pin": "768451",
        "cards": [{"card_no": "000034568911"}],
        "valid_from": now.isoformat(),
        "valid_until": (now + timedelta(hours=3)).isoformat(),
        "assignments": {"front": {"allowed_locks": [1, 2]}},
        **patch_values,
    }


@pytest.fixture
async def repo():
    repository = AccessRepository(AsyncMock())
    await repository.async_load(None)
    return repository


async def requested(repo):
    user = await repo.async_create(data(), approval=("requester", "host"))
    return user, repo.visit_requests()["items"][0]


async def test_server_filters_before_paging_so_older_pending_requests_cannot_be_hidden(repo):
    from custom_components.hikvision_intercom.access.visit_requests import public

    _, row = await requested(repo)
    state = repo.snapshot()
    for index in range(125):
        fake = deepcopy(row)
        fake.update(id=f"old-{index}", sequence=index + 2, status="approved")
        state["visit_requests"]["items"][fake["id"]] = fake
    assert not any(item["status"] == "pending" for item in public(state)["items"])
    pending = public(state, filters={"status": "pending"}, limit=100)
    assert pending["total"] == 1 and pending["items"][0]["id"] == row["id"]
    assert pending["next_offset"] is None
    assert public(state, filters={"status": "pending"}, offset=100)["offset"] == 0


async def test_visit_filters_use_authenticated_actor_and_search_only_safe_snapshot_fields(repo):
    _, row = await requested(repo)
    assert repo.visit_requests(filters={"scope": "approver"}, actor="host")["total"] == 1
    assert repo.visit_requests(filters={"scope": "requester"}, actor="host")["total"] == 0
    assert (
        repo.visit_requests(
            filters={"scope": "requester", "query": "MAINTENANCE"}, actor="requester"
        )["total"]
        == 1
    )
    assert repo.visit_requests(filters={"query": "768451"})["total"] == 0
    assert repo.visit_requests(filters={"query": "000034568911"})["total"] == 0
    assert repo.visit_requests(filters={"status": "approved"})["total"] == 0
    assert repo.visit_requests()["items"][0]["id"] == row["id"]


@pytest.mark.parametrize(
    "filters",
    [
        [],
        {"actor": "host"},
        {"status": []},
        {"status": "bad"},
        {"scope": []},
        {"scope": "anybody"},
        {"query": 7},
        {"query": "x" * 129},
    ],
)
async def test_malformed_visit_filters_are_rejected_without_changing_state(repo, filters):
    await requested(repo)
    before = repo.snapshot()
    with pytest.raises(AccessError, match="invalid_fields|invalid_text"):
        repo.visit_requests(filters=filters, actor="host")
    assert repo.snapshot() == before


async def decide(repo, row, **extra):
    return await repo.async_decide_visit(
        row["id"], expected_revision=row["revision"], actor="host", decision="approve", **extra
    )


async def test_creation_request_and_approval_share_durable_user_transaction_and_audit(repo):
    with audit_actor("requester", "visits/create"):
        user, row = await requested(repo)
    assert not user.active and row["status"] == "pending"
    public = repo.visit_requests()
    assert "768451" not in str(public) and "000034568911" not in str(public)
    assert row["snapshot"]["pin_configured"] and row["snapshot"]["enabled_cards"] == 1
    assert row["snapshot"]["doors"] == {"front": [1, 2]}
    with audit_actor("host", "visits/decide"):
        approved = await decide(repo, row)
    active = repo.get(user.id)
    assert active.active and approved["activated_revision"] == active.revision == user.revision + 1
    for key in (
        "pin",
        "cards",
        "valid_from",
        "valid_until",
        "access_purpose",
        "phone",
        "permission_overrides",
    ):
        assert active.private()[key] == user.private()[key]
    audit = repo.snapshot()["admin_audit"]["records"][-1]
    assert (
        audit["actor"] == "host"
        and audit["action"] == "visits/decide"
        and audit["fields"] == ["active"]
    )
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    assert restored.visit_requests() == repo.visit_requests() and restored.get(user.id).active


@pytest.mark.parametrize("actor", ["requester", "another-host", ""])
async def test_only_named_second_operator_can_approve(repo, actor):
    user, row = await requested(repo)
    before = repo.snapshot()
    with pytest.raises(AccessError, match="unauthorized"):
        await repo.async_decide_visit(
            row["id"], expected_revision=1, actor=actor, decision="approve"
        )
    assert repo.snapshot() == before and not repo.get(user.id).active


async def test_self_approval_active_guest_and_staff_cannot_enter_request_flow(repo):
    for values, approval, code in [
        (data(), ("same", "same"), "visit_second_operator_required"),
        (data(active=True), ("requester", "host"), "visit_inactive_required"),
        (data(access_category="staff"), ("requester", "host"), "temporary_user_required"),
    ]:
        with pytest.raises(AccessError, match=code):
            await repo.async_create(values, approval=approval)
        assert repo.users() == [] and repo.visit_requests()["total"] == 0


@pytest.mark.parametrize("route", ["update", "bulk"])
async def test_pending_request_blocks_all_existing_activation_paths(repo, route):
    user, _ = await requested(repo)
    before = repo.snapshot()
    with pytest.raises(AccessError, match="visit_approval_required"):
        if route == "update":
            await repo.async_update(user.id, {"active": True}, expected_revision=user.revision)
        else:
            repo.preview_bulk(
                [{"user_id": user.id, "revision": user.revision, "data": {"active": True}}]
            )
    assert repo.snapshot() == before


async def test_user_changes_stale_request_and_resubmission_requires_fresh_host_review(repo):
    user, row = await requested(repo)
    updated = await repo.async_update(
        user.id, {"access_purpose": "Changed visit"}, expected_revision=user.revision
    )
    assert repo.visit_requests()["items"][0]["stale"]
    with pytest.raises(AccessError, match="visit_request_stale"):
        await decide(repo, row)
    replacement = await repo.async_request_visit(
        user.id, expected_revision=updated.revision, actor="requester", approver="host-2"
    )
    assert repo.visit_requests()["items"][1]["status"] == "superseded"
    with pytest.raises(AccessError, match="revision_conflict"):
        await decide(repo, row)
    with pytest.raises(AccessError, match="visit_request_closed"):
        await decide(repo, {**row, "revision": row["revision"] + 1})
    await repo.async_decide_visit(
        replacement["id"], expected_revision=1, actor="host-2", decision="approve"
    )
    assert repo.get(user.id).active


async def test_concurrent_approvals_have_one_durable_winner(repo):
    user, row = await requested(repo)
    results = await asyncio.gather(decide(repo, row), decide(repo, row), return_exceptions=True)
    assert sum(isinstance(result, dict) for result in results) == 1
    assert sum(isinstance(result, AccessError) for result in results) == 1
    assert repo.get(user.id).revision == user.revision + 1
    assert repo.visit_requests()["revision"] == 2


async def test_failed_creation_save_has_neither_user_nor_request(repo):
    before = repo.snapshot()
    repo._save.side_effect = OSError("disk unavailable")
    with pytest.raises(OSError):
        await requested(repo)
    assert repo.snapshot() == before


async def test_expired_approval_and_false_revision_do_not_activate(repo):
    user, row = await requested(repo)
    before = repo.snapshot()
    with patch("custom_components.hikvision_intercom.access.visit_requests.datetime") as clock:
        clock.fromisoformat = datetime.fromisoformat
        clock.now.return_value = datetime.now(UTC) + timedelta(days=5)
        with pytest.raises(AccessError, match="invalid_validity"):
            await decide(repo, row)
    with pytest.raises(AccessError, match="revision_conflict"):
        await decide(repo, {**row, "revision": True})
    assert repo.snapshot() == before and not repo.get(user.id).active


async def test_approval_paging_is_bounded_and_returns_copies(repo):
    _, row = await requested(repo)
    projected = repo.visit_requests(limit=1)
    projected["items"][0]["snapshot"]["doors"]["front"].clear()
    assert repo.visit_requests()["items"][0]["snapshot"]["doors"] == {"front": [1, 2]}
    for params in ({"offset": -1}, {"limit": 201}, {"offset": True}):
        with pytest.raises(AccessError, match="invalid_fields"):
            repo.visit_requests(**params)
    assert repo.visit_requests(offset=1)["items"] == []
    assert row["status"] == "pending"


@pytest.mark.parametrize(
    "decision,actor", [("reject", "host"), ("cancel", "requester"), ("cancel", "host")]
)
async def test_closed_request_preserves_inactive_guest_and_can_be_submitted_again(
    repo, decision, actor
):
    user, row = await requested(repo)
    closed = await repo.async_decide_visit(
        row["id"], expected_revision=1, actor=actor, decision=decision
    )
    assert closed["status"] == {"reject": "rejected", "cancel": "cancelled"}[decision]
    assert not repo.get(user.id).active
    with pytest.raises(AccessError, match="visit_approval_required"):
        await repo.async_update(user.id, {"active": True}, expected_revision=user.revision)
    await repo.async_request_visit(
        user.id, expected_revision=user.revision, actor="requester", approver="host"
    )


async def test_cancelled_active_visit_requires_a_new_approval_to_reactivate(repo):
    user, row = await requested(repo)
    await decide(repo, row)
    active = repo.get(user.id)
    cancelled = await repo.async_cancel_temporary(user.id, expected_revision=active.revision)
    with pytest.raises(AccessError, match="visit_approval_required"):
        await repo.async_update(user.id, {"active": True}, expected_revision=cancelled.revision)
    new = await repo.async_request_visit(
        user.id, expected_revision=cancelled.revision, actor="requester", approver="host"
    )
    await decide(repo, new)
    assert repo.get(user.id).active


async def test_failed_save_or_capability_validation_leaves_request_and_user_unchanged(repo):
    user, row = await requested(repo)
    before = repo.snapshot()
    with pytest.raises(AccessError, match="unmanaged_lock"):
        await decide(repo, row, validate=Mock(side_effect=AccessError("unmanaged_lock")))
    assert repo.snapshot() == before
    repo._save.side_effect = OSError("Synthetic disk failure")
    with pytest.raises(OSError):
        await decide(repo, row)
    assert repo.snapshot() == before and not repo.get(user.id).active


async def test_manager_only_queues_successful_approval_not_rejection(repo):
    user, row = await requested(repo)
    manager = AccessManager(repo)
    with patch.object(manager, "_validate"), patch.object(manager, "request_user") as queued:
        await manager.async_decide_visit(row["id"], revision=1, actor="host", decision="reject")
        queued.assert_not_called()
        fresh = await repo.async_request_visit(
            user.id, expected_revision=user.revision, actor="requester", approver="host"
        )
        await manager.async_decide_visit(fresh["id"], revision=1, actor="host", decision="approve")
        queued.assert_called_once_with(user.id)
    await manager.async_close()


async def test_edit_approval_race_and_bulk_review_invalidation(repo):
    user, row = await requested(repo)
    results = await asyncio.gather(
        decide(repo, row),
        repo.async_update(user.id, {"access_purpose": "Changed"}, expected_revision=user.revision),
        return_exceptions=True,
    )
    assert sum(isinstance(result, AccessError) for result in results) == 1
    raw = repo.snapshot()
    assert raw["users"][user.id]["revision"] == user.revision + 1
    stamp = repo.bulk_stamp()
    if repo.get(user.id).active:
        await repo.async_cancel_temporary(user.id, expected_revision=repo.get(user.id).revision)
    current = repo.get(user.id)
    await repo.async_request_visit(
        user.id, expected_revision=current.revision, actor="requester", approver="host"
    )
    assert repo.bulk_stamp() != stamp


async def test_orphan_and_stale_requests_can_be_closed_without_activating(repo):
    user, row = await requested(repo)
    await repo.async_delete(user.id, expected_revision=user.revision)
    closed = await repo.async_decide_visit(
        row["id"], expected_revision=1, actor="requester", decision="cancel"
    )
    assert closed["status"] == "cancelled" and repo.visit_requests()["items"][0]["user_deleted"]


async def test_schema_ten_migration_is_durable_and_corrupt_request_cannot_activate(repo):
    user, row = await requested(repo)
    legacy = repo.snapshot()
    legacy["schema"] = 10
    legacy.pop("visit_requests")
    save = AsyncMock(side_effect=OSError("Synthetic disk failure"))
    restored = AccessRepository(save)
    with pytest.raises(OSError):
        await restored.async_load(legacy)
    assert restored.users() == []
    save.side_effect = None
    await restored.async_load(legacy)
    assert (
        restored.get(user.id).private() == user.private()
        and restored.visit_requests()["total"] == 0
    )
    corrupt = deepcopy(repo.snapshot())
    corrupt["users"][user.id]["active"] = True
    with pytest.raises(AccessError, match="invalid_storage"):
        await AccessRepository(AsyncMock()).async_load(corrupt)
    corrupt = deepcopy(repo.snapshot())
    corrupt["visit_requests"]["items"][row["id"]]["snapshot"]["pin"] = "768451"
    with pytest.raises(AccessError, match="invalid_storage"):
        await AccessRepository(AsyncMock()).async_load(corrupt)
