import asyncio
from copy import deepcopy
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.access.admin_audit import audit_actor
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.policy_versions import LIMIT, compare, listing
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.profile_settings import ProfileSettings

VALUES = {
    "fields": [
        {"id": "department", "label": "Department", "enabled": True, "type": "text", "options": []}
    ],
    "groups": [{"id": "staff", "label": "Staff", "enabled": True, "station_ids": ["front"]}],
    "photo_enabled": False,
}


async def setup():
    save = AsyncMock()
    repo = AccessRepository(save)
    await repo.async_load(None)
    settings = ProfileSettings(repo.async_profile_settings, lambda: None, repo.profile_settings)
    await settings.update(0, VALUES)
    return repo, settings, save


async def test_old_policy_seeds_known_baseline_without_inventing_history():
    repo, settings, _ = await setup()
    raw = repo.snapshot()
    raw["profile_settings"]["schema"] = 4
    raw["profile_settings"].pop("versions")
    save = AsyncMock()
    restored = AccessRepository(save)
    await restored.async_load(raw)
    policy = restored.profile_settings()
    save.assert_awaited_once()
    assert save.call_args.args[0]["profile_settings"] == policy
    assert policy["schema"] == 5
    assert policy["versions"][0]["revision"] == 1 and policy["versions"][0]["saved_at"] is None
    assert listing(policy, 0, 10)["history_complete"] is False


async def test_authenticated_commit_diff_has_no_person_credentials_or_restore():
    repo, settings, _ = await setup()
    person = await repo.async_create(
        {
            "display_name": "Private name",
            "pin": "827461",
            "group_ids": ["staff"],
            "permission_overrides": {"front": "deny"},
        }
    )
    values = deepcopy(VALUES)
    values["groups"][0]["label"] = "Operators"
    values["fields"][0]["required"] = True
    with audit_actor("admin-one", "profiles/settings_update"):
        await settings.update(1, values)
    policy = repo.profile_settings()
    assert policy["versions"][-1]["actor"] == "admin-one"
    result = compare(policy, 1, 2)
    assert result["summary"] == {"fields": 1, "groups": 1}
    assert {c["property"] for r in result["rows"] for c in r["changes"]} == {"label", "required"}
    assert "827461" not in str(policy["versions"]) and "Private name" not in str(result)
    assert not repo.get(person.id).assignments["front"].enabled and repo.get(
        person.id
    ).permission_overrides == {"front": "deny"}
    assert result["read_only"] and result["physical_result"] == "not_verified"


async def test_failed_save_cannot_append_a_phantom_version():
    repo, settings, save = await setup()
    before = repo.snapshot()
    save.side_effect = OSError("disk full")
    values = deepcopy(VALUES)
    values["groups"][0]["label"] = "Operators"
    with pytest.raises(OSError):
        await settings.update(1, values)
    assert repo.snapshot() == before and settings.public()["revision"] == 1


async def test_commit_refreshes_preview_authorship_and_station_change_history():
    repo, settings, _ = await setup()

    def mutation(state):
        state["profile_settings"]["values"]["groups"][0]["station_ids"] = ["new-front"]
        state["profile_settings"]["revision"] += 1

    with audit_actor("admin-two", "platform/lifecycle_apply"):
        await repo._commit(mutation)
    record = repo.profile_settings()["versions"][-1]
    assert record["actor"] == "admin-two" and record["action"] == "platform/lifecycle_apply"
    assert (
        compare(repo.profile_settings(), 1, 2)["rows"][0]["changes"][0]["property"] == "station_ids"
    )


async def test_retention_and_paging_are_bounded_and_old_versions_not_found():
    repo, settings, _ = await setup()
    for revision in range(1, LIMIT + 5):
        values = deepcopy(VALUES)
        values["groups"][0]["label"] = f"Staff {revision}"
        await settings.update(revision, values)
    policy = repo.profile_settings()
    assert len(policy["versions"]) == LIMIT
    page = listing(policy, 0, 10)
    assert page["records"][0]["revision"] == LIMIT + 5 and page["next_offset"] == 10
    assert page["retained_from_revision"] == 6
    with pytest.raises(AccessError, match="policy_version_not_found"):
        compare(policy, 1, 2)


async def test_repeated_cancellation_keeps_one_durable_policy_version():
    repo, settings, _ = await setup()
    entered, release = asyncio.Event(), asyncio.Event()
    saved = []

    async def save(data):
        entered.set()
        await release.wait()
        saved.append(data)

    repo._save = save
    values = deepcopy(VALUES)
    values["groups"][0]["label"] = "Operators"
    task = asyncio.create_task(settings.update(1, values))
    await entered.wait()
    task.cancel()
    await asyncio.sleep(0)
    task.cancel()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(repo.profile_settings()["versions"]) == 2
    restored = AccessRepository(AsyncMock())
    await restored.async_load(saved[-1])
    assert restored.profile_settings() == repo.profile_settings()


@pytest.mark.parametrize("tamper", ["current_values", "revision", "actor", "timestamp"])
async def test_corrupt_history_is_rejected_without_reset(tamper):
    repo, _, _ = await setup()
    raw = repo.snapshot()
    latest = raw["profile_settings"]["versions"][-1]
    if tamper == "current_values":
        latest["values"]["groups"][0]["label"] = "wrong"
    if tamper == "revision":
        latest["revision"] = 0
    if tamper == "actor":
        latest["actor"] = False
    if tamper == "timestamp":
        latest["saved_at"] = "bad"
    save = AsyncMock()
    with pytest.raises(AccessError, match="invalid_storage"):
        await AccessRepository(save).async_load(raw)
    save.assert_not_called()


async def test_same_version_compare_and_invalid_page_do_not_mutate():
    repo, _, _ = await setup()
    before = repo.snapshot()
    assert compare(repo.profile_settings(), 1, 1)["rows"] == []
    for offset, limit in [(True, 10), (0, 0), (0, 51), (-1, 10)]:
        with pytest.raises(AccessError, match="invalid_fields"):
            listing(repo.profile_settings(), offset, limit)
    assert repo.snapshot() == before


async def test_direct_policy_update_regenerates_history_from_committed_source():
    repo, _, _ = await setup()
    proposed = repo.profile_settings()
    proposed["revision"] += 1
    proposed["values"]["groups"][0]["label"] = "Operators"
    proposed["versions"] = [{"actor": "untrusted-preview"}]
    with audit_actor("real-admin", "profiles/settings_update"):
        await repo.async_profile_settings(proposed)
    policy = repo.profile_settings()
    assert len(policy["versions"]) == 2
    assert policy["versions"][-1]["actor"] == "real-admin"
    assert policy["versions"][-1]["values"] == policy["values"]
    assert compare(policy, 1, 2)["summary"] == {"fields": 0, "groups": 1}
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    assert restored.profile_settings() == policy
