"""New administration paths retain atomic ownership, revocations and local-only updates."""

import json
from copy import deepcopy
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.access.manager import AccessManager
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.permission_directory import directory
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.profile_settings import ProfileSettings


@pytest.fixture
async def managed():
    repo = AccessRepository(AsyncMock())
    await repo.async_load(None)
    profiles = ProfileSettings(repo.async_profile_settings, lambda: None, repo.profile_settings)
    await profiles.update(
        0,
        {
            "photo_enabled": False,
            "fields": [{"id": "department", "label": "Department", "enabled": True, "options": []}],
            "groups": [
                {"id": "staff", "label": "Staff", "enabled": True, "station_ids": ["a", "b"]}
            ],
        },
    )
    manager = AccessManager(repo)
    manager.register("a", "Gate", True)
    manager.register("b", "Lobby", True)
    user = await repo.async_create(
        {
            "display_name": "Example",
            "employee_no": "12345",
            "profile": {"department": "Old"},
            "group_ids": ["staff"],
            "permission_overrides": {"b": "deny"},
            "pin": "739102",
            "cards": [{"card_no": "887799"}],
        }
    )
    yield manager, user, profiles
    await manager.async_close()


def request(user, action, **extra):
    return {
        "action": action,
        "selection": [{"user_id": user.id, "revision": user.revision}],
        **extra,
    }


async def test_metadata_bulk_is_atomic_local_and_replayable(managed):
    manager, user, _ = managed
    before = manager.repository.snapshot()
    preview = await manager.bulk.preview(
        "admin", request(user, "profile", profile={"department": "New"})
    )
    assert manager.repository.snapshot() == before
    assert preview["changed"] == 1 and preview["stations"] == []
    assert preview["rows"][0]["profile_changes"]["department"] == {"before": "Old", "after": "New"}
    receipt = await manager.bulk.apply("admin", preview["operation_id"])
    updated = manager.repository.get(user.id)
    assert (
        updated.profile == {"department": "New"}
        and updated.pin == user.pin
        and updated.cards == user.cards
    )
    assert all(not station.pending for station in manager.stations.values())
    assert await manager.bulk.apply("admin", preview["operation_id"]) == receipt
    assert manager.repository.get(user.id).revision == updated.revision
    saved = manager.repository.snapshot()
    assert saved["admin_audit"]["records"][-1]["action"] == "bulk/profile"
    restored = AccessRepository(AsyncMock())
    await restored.async_load(saved)
    assert restored.get(user.id).profile == updated.profile
    for value in ("739102", "887799"):
        assert value not in json.dumps(preview) and value not in json.dumps(receipt)


async def test_group_removal_keeps_personal_block_and_queues_offline_revoke(managed):
    manager, user, _ = managed
    preview = await manager.bulk.preview(
        "admin", request(user, "group_remove", group_ids=["staff"])
    )
    assert preview["rows"][0]["permissions_before"] == ["a"]
    assert preview["rows"][0]["permissions_after"] == []
    await manager.bulk.apply("admin", preview["operation_id"])
    updated = manager.repository.get(user.id)
    assert updated.group_ids == [] and updated.permission_overrides == {"b": "deny"}
    assert manager.stations["a"].pending
    assert updated.pin == user.pin and updated.cards == user.cards
    repeat = await manager.bulk.preview("admin", request(updated, "group_add", group_ids=["staff"]))
    await manager.bulk.apply("admin", repeat["operation_id"])
    updated = manager.repository.get(user.id)
    assert updated.assignments["a"].enabled and not updated.assignments["b"].enabled


async def test_reviewed_reset_restores_inheritance_and_failure_changes_nothing(managed):
    manager, user, _ = managed
    preview = await manager.bulk.preview("admin", request(user, "reset_overrides"))
    assert preview["rows"][0]["permissions_after"] == ["a", "b"]
    before = manager.repository.snapshot()
    manager.repository._save.side_effect = OSError("disk")
    with pytest.raises(OSError):
        await manager.bulk.apply("admin", preview["operation_id"])
    assert manager.repository.snapshot() == before
    manager.repository._save.side_effect = None
    await manager.bulk.apply("admin", preview["operation_id"])
    assert manager.repository.get(user.id).permission_overrides == {}


@pytest.mark.parametrize(
    "action,extra",
    [
        ("profile", {"profile": {"unknown": "value"}}),
        ("group_add", {"group_ids": ["missing"]}),
        ("group_remove", {"group_ids": []}),
        ("profile", {"profile": {}, "group_ids": ["staff"]}),
    ],
)
async def test_invalid_bulk_metadata_cannot_touch_state(managed, action, extra):
    manager, user, _ = managed
    before = manager.repository.snapshot()
    with pytest.raises(AccessError):
        await manager.bulk.preview("admin", request(user, action, **extra))
    assert manager.repository.snapshot() == before


async def test_profile_policy_change_invalidates_bulk_review(managed):
    manager, user, policy = managed
    preview = await manager.bulk.preview(
        "admin", request(user, "profile", profile={"department": "New"})
    )
    values = deepcopy(policy.public())
    values.pop("revision")
    values["groups"][0]["enabled"] = False
    await policy.update(1, values)
    with pytest.raises(AccessError, match="bulk_review_stale"):
        await manager.bulk.apply("admin", preview["operation_id"])


async def test_directory_separates_grants_blocks_and_applied_revision(managed):
    manager, user, _ = managed
    state = manager.repository.snapshot()
    report = directory(state, {"station_id": "a"})
    assert report["total"] == 1 and report["device_writes"] == 0
    door = report["rows"][0]["doors"][0]
    assert door["allowed"] and door["groups"] == ["Staff"] and door["applied_revision"] is None
    assert directory(state, {"station_id": "b"})["total"] == 0
    blocked = directory(state, {"station_id": "b", "mode": "exceptions"})
    assert blocked["rows"][0]["doors"][0]["override"] == "deny"
    assert not blocked["rows"][0]["doors"][0]["allowed"]
    assert directory(state, {"mode": "exceptions", "offset": 1, "limit": 1})["rows"] == []
    assert state == manager.repository.snapshot()
    assert "739102" not in json.dumps(report) and "887799" not in json.dumps(report)
    await manager.repository.async_update(
        user.id, {"active": False}, expected_revision=user.revision
    )
    assert directory(manager.repository.snapshot(), {"station_id": "a"})["total"] == 0


@pytest.mark.parametrize(
    "filters",
    [
        {"limit": True},
        {"offset": -1},
        {"mode": "x"},
        {"mode": []},
        {"station_id": []},
        {"search": []},
        {"unknown": 1},
    ],
)
async def test_directory_rejects_unbounded_or_invalid_requests(managed, filters):
    with pytest.raises(AccessError):
        directory(managed[0].repository.snapshot(), filters)


async def test_policy_preview_is_read_only_and_commit_preserves_exceptions(managed):
    manager, user, profiles = managed
    data = profiles.public()
    revision = data.pop("revision")
    data["groups"][0]["station_ids"] = ["b"]
    before = manager.repository.snapshot()
    review = await manager.policy.preview("admin", revision, data)
    assert manager.repository.snapshot() == before
    assert review["requires_confirmation"] and review["changed"] == 1
    assert review["rows"][0]["before"] == ["a"] and review["rows"][0]["after"] == []
    assert set(review["offline"]) == {"a", "b"}
    with pytest.raises(AccessError):
        await manager.policy.apply("other", review["operation_id"])
    manager.repository._save.side_effect = OSError("disk full")
    with pytest.raises(OSError):
        await manager.policy.apply("admin", review["operation_id"])
    assert manager.repository.snapshot() == before
    manager.repository._save.side_effect = None
    receipt = await manager.policy.apply("admin", review["operation_id"])
    assert receipt["changed"] == 1 and manager.stations["a"].pending
    assert manager.repository.get(user.id).permission_overrides == {"b": "deny"}
    assert profiles.public()["revision"] == revision + 1
    assert await manager.policy.apply("admin", review["operation_id"]) == receipt
    restored = AccessRepository(AsyncMock())
    await restored.async_load(manager.repository.snapshot())
    assert restored.snapshot()["operation_receipts"][review["operation_id"]] == receipt


async def test_policy_preview_expires_if_user_or_rules_change(managed):
    manager, user, profiles = managed
    data = profiles.public()
    revision = data.pop("revision")
    data["groups"][0]["enabled"] = False
    review = await manager.policy.preview("admin", revision, data)
    await manager.repository.async_update(
        user.id, {"display_name": "Changed"}, expected_revision=user.revision
    )
    with pytest.raises(AccessError, match="bulk_review_stale"):
        await manager.policy.apply("admin", review["operation_id"])
    assert profiles.public()["revision"] == revision
    review = await manager.policy.preview("admin", revision, data)
    manager.policy.reviews[review["operation_id"]]["deadline"] = 0
    with pytest.raises(AccessError, match="bulk_review_expired"):
        await manager.policy.apply("admin", review["operation_id"])


async def test_policy_rename_needs_no_permission_confirmation_or_device_jobs(managed):
    manager, user, profiles = managed
    data = profiles.public()
    revision = data.pop("revision")
    data["groups"][0]["label"] = "Leadership"
    review = await manager.policy.preview("admin", revision, data)
    assert not review["requires_confirmation"] and not review["rows"]
    assert not review["stations"]
    await manager.policy.apply("admin", review["operation_id"])
    assert manager.repository.get(user.id).revision == user.revision
    assert all(not s.pending for s in manager.stations.values())


async def test_policy_cancelled_reply_still_queues_committed_revocations(managed):
    import asyncio

    manager, _, profiles = managed
    data = profiles.public()
    revision = data.pop("revision")
    data["groups"][0]["enabled"] = False
    review = await manager.policy.preview("admin", revision, data)
    started, release = asyncio.Event(), asyncio.Event()

    async def save(_):
        started.set()
        await release.wait()

    manager.repository._save.side_effect = save
    task = asyncio.create_task(manager.policy.apply("admin", review["operation_id"]))
    await started.wait()
    task.cancel()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert manager.stations["a"].pending
    assert manager.bulk.receipt("admin", review["operation_id"])["changed"] == 1


async def test_schema_five_upgrade_preserves_ownership_and_profile_data(managed):
    manager, user, _ = managed
    state = manager.repository.snapshot()
    state["schema"] = 5
    save = AsyncMock()
    restored = AccessRepository(save)
    await restored.async_load(state)
    assert restored.snapshot()["schema"] == 6
    assert restored.get(user.id).private() == manager.repository.get(user.id).private()
    save.assert_awaited_once()
