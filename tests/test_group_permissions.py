"""Group policy changes are durable with their effective user permissions."""

import asyncio
from copy import deepcopy
from unittest.mock import AsyncMock

import httpx
import pytest
from test_access_engine import CAP, Device

from custom_components.hikvision_intercom.access.engine import SyncEngine
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.client.access import AccessClient
from custom_components.hikvision_intercom.client.client import ConnectionSettings, HikvisionClient
from custom_components.hikvision_intercom.profile_settings import ProfileSettings

VALUES = {
    "fields": [],
    "photo_enabled": False,
    "groups": [
        {"id": "management", "label": "Management", "enabled": True, "station_ids": ["a", "b"]},
        {"id": "maintenance", "label": "Maintenance", "enabled": True, "station_ids": ["b", "c"]},
    ],
}


def allowed(user):
    return {s for s, a in user.assignments.items() if a.enabled}


async def setup():
    save = AsyncMock()
    repo = AccessRepository(save)
    await repo.async_load(None)
    policy = ProfileSettings(repo.async_profile_settings, lambda: None, repo.profile_settings)
    await policy.update(0, VALUES)
    return repo, policy, save


async def test_union_personal_allow_deny_and_reset_survive_group_changes():
    repo, policy, _ = await setup()
    user = await repo.async_create(
        {
            "display_name": "Demo",
            "group_ids": ["management", "maintenance"],
            "permission_overrides": {"b": "deny", "d": "allow"},
        }
    )
    assert allowed(user) == {"a", "c", "d"}
    user = await repo.async_update(
        user.id, {"group_ids": ["maintenance"]}, expected_revision=user.revision
    )
    assert allowed(user) == {"c", "d"} and user.permission_overrides["b"] == "deny"
    changed = deepcopy(VALUES)
    changed["groups"][1]["station_ids"] = ["b", "e"]
    await policy.update(1, changed)
    assert allowed(repo.get(user.id)) == {"d", "e"}
    user = await repo.async_update(
        user.id, {"permission_overrides": {}}, expected_revision=repo.get(user.id).revision
    )
    assert allowed(user) == {"b", "e"}
    changed["groups"][1]["enabled"] = False
    await policy.update(2, changed)
    assert not allowed(repo.get(user.id))
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    assert not allowed(restored.get(user.id)) and restored.get(user.id).group_ids == ["maintenance"]


async def test_atomic_failed_policy_save_changes_neither_members_nor_definition():
    repo, policy, save = await setup()
    user = await repo.async_create({"display_name": "Demo", "group_ids": ["management"]})
    before = repo.snapshot()
    save.side_effect = OSError("disk full")
    changed = deepcopy(VALUES)
    changed["groups"][0]["station_ids"] = []
    with pytest.raises(OSError):
        await policy.update(1, changed)
    assert repo.snapshot() == before and policy.public()["revision"] == 1
    assert allowed(repo.get(user.id)) == {"a", "b"}


async def test_rename_does_not_resync_and_stale_editor_or_bulk_review_cannot_apply():
    repo, policy, _ = await setup()
    user = await repo.async_create({"display_name": "Demo", "group_ids": ["management"]})
    stamp = repo.bulk_stamp()
    changed = deepcopy(VALUES)
    changed["groups"][0]["label"] = "Leadership"
    await policy.update(1, changed)
    assert repo.get(user.id).revision == user.revision
    assert repo.bulk_stamp() != stamp
    with pytest.raises(AccessError, match="group_policy_changed"):
        await repo.async_update(
            user.id,
            {"permission_overrides": {}, "access_policy_revision": 1},
            expected_revision=user.revision,
        )
    assert allowed(repo.get(user.id)) == {"a", "b"}


async def test_cancellation_after_durable_policy_save_is_visible_after_reload():
    repo, policy, _ = await setup()
    user = await repo.async_create({"display_name": "Demo", "group_ids": ["management"]})
    entered, release = asyncio.Event(), asyncio.Event()
    saved = []

    async def save(value):
        entered.set()
        await release.wait()
        saved.append(value)

    repo._save = save
    changed = deepcopy(VALUES)
    changed["groups"][0]["station_ids"] = []
    task = asyncio.create_task(policy.update(1, changed))
    await entered.wait()
    task.cancel()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert policy.public()["revision"] == 2 and not allowed(repo.get(user.id))
    restored = AccessRepository(AsyncMock())
    await restored.async_load(saved[-1])
    assert not allowed(restored.get(user.id))


async def test_legacy_manual_access_stays_personal_after_policy_seed():
    repo = AccessRepository(AsyncMock())
    user = await repo.async_create(
        {"display_name": "Demo", "assignments": {"a": {"allowed_locks": [1]}}}
    )
    raw = repo.snapshot()
    raw["schema"] = 4
    raw.pop("profile_settings")
    raw["users"][user.id].pop("permission_overrides")
    migrated = AccessRepository(AsyncMock())
    await migrated.async_load(raw)
    policy = ProfileSettings(
        migrated.async_profile_settings, lambda: None, migrated.profile_settings
    )
    await policy.update(0, VALUES)
    assert migrated.get(user.id).permission_overrides == {"a": "allow"}
    assert allowed(migrated.get(user.id)) == {"a"}


async def test_old_settings_client_cannot_erase_grants_and_corrupt_effective_access_rejected():
    repo, policy, _ = await setup()
    user = await repo.async_create({"display_name": "Demo", "group_ids": ["management"]})
    old_client = deepcopy(VALUES)
    for group in old_client["groups"]:
        group.pop("station_ids")
    old_client["groups"][0]["label"] = "Leadership"
    await policy.update(1, old_client)
    assert allowed(repo.get(user.id)) == {"a", "b"}
    damaged = repo.snapshot()
    damaged["users"][user.id]["permission_overrides"] = {"a": "deny"}
    with pytest.raises(AccessError, match="invalid_storage"):
        await AccessRepository(AsyncMock()).async_load(damaged)


async def test_revocation_while_offline_survives_restart_without_affecting_other_station():
    repo, policy, _ = await setup()
    user = await repo.async_create(
        {
            "display_name": "Demo",
            "employee_no": "1001",
            "pin": "567890",
            "group_ids": ["management"],
        }
    )
    devices = {s: Device() for s in ("a", "b")}
    sessions = {
        s: httpx.AsyncClient(transport=httpx.MockTransport(d.handle)) for s, d in devices.items()
    }
    drivers = {
        s: AccessClient(
            HikvisionClient(
                http,
                ConnectionSettings("192.0.2.1", "demo", "test"),
                enabled_doors=frozenset({1}),
            )
        )
        for s, http in sessions.items()
    }
    try:
        for driver in drivers.values():
            driver.capabilities = CAP
        engine = SyncEngine(repo)
        for s, driver in drivers.items():
            assert (await engine.async_reconcile(s, driver)).failed == 0
        assert all("1001" in d.users for d in devices.values())
        devices["a"].offline = True
        changed = deepcopy(VALUES)
        changed["groups"][0]["station_ids"] = ["b"]
        await policy.update(1, changed)
        restored = AccessRepository(AsyncMock())
        await restored.async_load(repo.snapshot())
        engine = SyncEngine(restored)
        assert user.id in engine.jobs("a")
        assert (await engine.async_reconcile("b", drivers["b"])).failed == 0
        assert "1001" in devices["b"].users
        devices["a"].offline = False
        assert (await engine.async_reconcile("a", drivers["a"])).failed == 0
        assert "1001" not in devices["a"].users and "1001" in devices["b"].users
        assert restored.get(user.id).pin.value == "567890"
        assert not restored.snapshot()["bindings"].get("a", {})
    finally:
        await asyncio.gather(*(http.aclose() for http in sessions.values()))


async def test_personal_grant_within_group_survives_unrelated_legacy_assignment_edit():
    repo, policy, _ = await setup()
    user = await repo.async_create(
        {
            "display_name": "Demo",
            "group_ids": ["management"],
            "permission_overrides": {"a": "allow"},
        }
    )
    updated = await repo.async_update(
        user.id,
        {
            "assignments": {
                "a": {"allowed_locks": [1]},
                "b": {"allowed_locks": [1]},
                "d": {"allowed_locks": [1]},
            }
        },
        expected_revision=user.revision,
    )
    assert updated.permission_overrides == {"a": "allow", "d": "allow"}
    values = deepcopy(VALUES)
    values["groups"][0]["enabled"] = False
    await policy.update(1, values)
    assert allowed(repo.get(user.id)) == {"a", "d"}
