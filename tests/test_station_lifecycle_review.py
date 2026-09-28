"""Lifecycle projections preserve group semantics and never mutate desired ownership."""

from copy import deepcopy
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.access.station_lifecycle import impact
from custom_components.hikvision_intercom.client.access import StationInventory
from custom_components.hikvision_intercom.profile_settings import ProfileSettings


async def setup():
    save = AsyncMock()
    repo = AccessRepository(save)
    await repo.async_load(None)
    settings = ProfileSettings(repo.async_profile_settings, lambda: None, repo.profile_settings)
    await settings.update(
        0,
        {
            "fields": [],
            "photo_enabled": False,
            "groups": [
                {"id": "staff", "label": "Staff", "enabled": True, "station_ids": ["old", "other"]},
                {"id": "future", "label": "Future", "enabled": False, "station_ids": ["old"]},
            ],
        },
    )
    user = await repo.async_create(
        {
            "display_name": "Inherited",
            "group_ids": ["staff"],
            "permission_overrides": {},
            "pin": "876543",
            "door_permissions": {"old": [1, 2]},
        }
    )
    denied = await repo.async_create(
        {
            "display_name": "Denied",
            "group_ids": ["staff"],
            "permission_overrides": {"old": "deny", "unrelated": "allow"},
        }
    )
    personal = await repo.async_create(
        {"display_name": "Personal", "permission_overrides": {"old": "allow"}, "active": False}
    )
    return repo, save, user, denied, personal


async def test_replacement_projects_inheritance_denials_and_physical_locks_without_secrets():
    repo, save, user, denied, personal = await setup()
    before, calls = repo.snapshot(), save.await_count
    review = impact(repo, "old", "new", target_locks={1, 2}, target_inventory=StationInventory())
    rows = {row["user_id"]: row for row in review["rows"]}
    assert rows[user.id]["source_permission"] == "group"
    assert rows[user.id]["after"] == ["new", "other"]
    assert rows[user.id]["locks"] == [1, 2]
    assert rows[denied.id]["source_permission"] == "deny"
    assert rows[denied.id]["after"] == ["other", "unrelated"]
    assert rows[personal.id]["after"] == ["new"] and not rows[personal.id]["active"]
    assert review["groups"][1]["after"] == ["new"] and not review["groups"][1]["enabled"]
    assert review["required_target_locks"] == [1, 2]
    assert review["device_writes"] == 0 and not review["can_apply"]
    assert review["blockers"] == [] and not review["cleanup_verified"]
    assert repo.snapshot() == before and save.await_count == calls
    assert "876543" not in str(review)
    assert all("pin" not in row and "cards" not in row for row in review["rows"])


async def test_retirement_preserves_other_doors_and_reports_owned_and_unknown_inventory():
    repo, save, user, _, _ = await setup()
    await repo.async_bind("old", user.id, fingerprint="verified-fixture", adopted=True)
    inventory = StationInventory({user.employee_no: {}, "foreign": {}}, {})
    before = deepcopy(repo.snapshot())
    review = impact(repo, "old", None, target_locks=set(), source_inventory=inventory)
    assert review["groups"][0]["after"] == ["other"]
    assert review["known_bindings"] == 1 and review["unknown_owners"] == 1
    assert not review["source_removal_ready"]
    assert repo.snapshot() == before
    save.assert_awaited()


async def test_target_conflicts_never_merge_or_overwrite_personal_exceptions():
    repo, _, user, _, _ = await setup()
    await repo.async_update(
        user.id, {"permission_overrides": {"new": "deny"}}, expected_revision=user.revision
    )
    review = impact(repo, "old", "new", target_locks={1, 2}, target_inventory=StationInventory())
    assert "target_already_in_use" in review["blockers"]
    assert all(row["after"] is None for row in review["rows"])


async def test_bound_rows_keep_exact_affected_count_and_unknown_ownership_unknown():
    repo, _, _, _, _ = await setup()
    review = impact(
        repo,
        "old",
        "new",
        target_locks={1},
        target_inventory=StationInventory(),
        row_budget=1,
        hold_programs=2,
    )
    assert review["affected_people"] == 3 and len(review["rows"]) == 1
    assert not review["rows_complete"] and review["unknown_owners"] is None
    assert set(review["blockers"]) == {
        "target_lock_mapping_incomplete",
        "hold_programs_require_separate_review",
    }
    with pytest.raises(AccessError, match="invalid_fields"):
        impact(repo, "old", "old", target_locks={1})


async def test_pending_tombstone_and_retired_pin_remain_reserved_during_review():
    repo, save, user, _, _ = await setup()
    await repo.async_bind("old", user.id, fingerprint="fixture", adopted=True)
    await repo.async_update(
        user.id, {"pin": "987654"}, expected_revision=repo.get(user.id).revision
    )
    await repo.async_delete(user.id, expected_revision=repo.get(user.id).revision)
    before, calls = repo.snapshot(), save.await_count
    review = impact(repo, "old", None, target_locks=set())
    assert review["pending_cleanup"]["tombstones"] == 1
    assert review["pending_cleanup"]["retired_pins"] == 1
    assert "876543" not in str(review) and "987654" not in str(review)
    assert repo.snapshot() == before and save.await_count == calls
    restored = AccessRepository(AsyncMock())
    await restored.async_load(before)
    assert restored.snapshot() == before


async def test_unobserved_and_nonempty_replacement_inventory_are_not_assumed_safe():
    repo, _, _, _, _ = await setup()
    missing = impact(repo, "old", "new", target_locks={1, 2})
    assert "target_ownership_unverified" in missing["blockers"]
    existing = impact(
        repo,
        "old",
        "new",
        target_locks={1, 2},
        target_inventory=StationInventory({"foreign": {"password": "do-not-project"}}, {}),
    )
    assert "target_contains_accounts" in existing["blockers"]
    assert "do-not-project" not in str(existing)


async def test_native_user_timing_is_not_projected_as_certified_replacement_timing():
    from test_user_timing import weekly

    repo, _, user, _, _ = await setup()
    await repo.async_update(
        user.id,
        {"access_timing_policy": {"mode": "native", "schedule": weekly(), "bindings": {}}},
        expected_revision=user.revision,
    )
    before = repo.snapshot()
    review = impact(repo, "old", "new", target_locks={1, 2}, target_inventory=StationInventory())
    assert review["native_schedules"] == 1
    assert "native_schedule_redeployment_required" in review["blockers"]
    assert next(row for row in review["rows"] if row["user_id"] == user.id)["native_schedule"]
    assert repo.snapshot() == before
