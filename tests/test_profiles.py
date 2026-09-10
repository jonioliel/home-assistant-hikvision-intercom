"""Local profile persistence, migration and isolation from access credentials."""

import base64
from copy import deepcopy
from unittest.mock import AsyncMock, Mock

import pytest

from custom_components.hikvision_intercom.access.admin_audit import audit_actor
from custom_components.hikvision_intercom.access.csv_transfer import desired_fields
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.profile_settings import ProfileSettings, photo_value

# Minimal structural JPEG fixture; browser tests use real canvas-encoded images.
PHOTO = (
    "data:image/jpeg;base64,"
    + base64.b64encode(
        bytes.fromhex("ffd8 ffc0 000b 08 0100 0100 01 011100 ffda 0002 ffd9")
    ).decode()
)
VALUES = {
    "photo_enabled": True,
    "fields": [
        {
            "id": "department",
            "label": "Department",
            "enabled": True,
            "options": ["Staff", "Maintenance"],
        }
    ],
    "groups": [{"id": "team", "label": "Team", "enabled": True}],
}


async def test_definition_rename_archive_cas_and_failed_save():
    save = AsyncMock()
    changed = Mock()
    settings = ProfileSettings(save, lambda: changed())
    await settings.update(0, VALUES)
    renamed = deepcopy(VALUES)
    renamed["fields"][0].update(label="Apartment", enabled=False)
    await settings.update(1, renamed)
    restored = ProfileSettings(AsyncMock(), lambda: None)
    restored.load(save.call_args.args[0])
    assert restored.public()["fields"][0]["id"] == "department"
    with pytest.raises(AccessError, match="revision_conflict"):
        await settings.update(1, VALUES)
    removed = deepcopy(renamed)
    removed["fields"] = []
    with pytest.raises(AccessError, match="profile_definition_in_use"):
        await settings.update(2, removed)
    save.side_effect = OSError("disk")
    with pytest.raises(OSError):
        await settings.update(2, VALUES)
    assert settings.public()["revision"] == 2


async def test_profile_photo_atomic_preserves_device_intent_and_no_audit_image():
    repo = AccessRepository(AsyncMock())
    user = await repo.async_create(
        {
            "display_name": "Demo",
            "assignments": {"station": {"enabled": True, "allowed_locks": [1]}},
        }
    )
    before = desired_fields(user)
    with audit_actor("admin", "users/update"):
        updated = await repo.async_update(
            user.id,
            {"profile": {"department": "Staff"}, "group_ids": ["team"], "photo": PHOTO},
            expected_revision=1,
        )
    assert desired_fields(updated) == before
    assert updated.assignments["station"].desired_revision == 2
    assert updated.assignments["station"].applied_revision is None
    assert updated.revision == 2
    assert updated.public()["photo_configured"] and "photo" not in updated.public()
    assert PHOTO not in str(repo.public())
    audit = repo.snapshot()["admin_audit"]["records"][-1]
    assert audit["fields"] == ["group_ids", "photo", "profile"]
    assert PHOTO not in str(audit) and "Staff" not in str(audit)
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    assert restored.get(user.id).photo == PHOTO
    await repo.async_delete(user.id, expected_revision=2)
    tomb = repo.snapshot()["tombstones"][user.id]["record"]
    assert tomb["photo"] is None and tomb["profile"] == {} and tomb["group_ids"] == []


async def test_schema_three_profile_defaults_and_failed_migration():
    original = AccessRepository(AsyncMock())
    user = await original.async_create({"display_name": "Demo"})
    raw = original.snapshot()
    raw["schema"] = 3
    raw.pop("profile_settings")
    for key in ("profile", "group_ids", "photo"):
        raw["users"][user.id].pop(key)
    save = AsyncMock(side_effect=OSError())
    repo = AccessRepository(save)
    with pytest.raises(OSError):
        await repo.async_load(raw)
    save.side_effect = None
    await repo.async_load(raw)
    assert repo.snapshot()["schema"] == 6
    assert repo.get(user.id).profile == {} and repo.get(user.id).photo is None


@pytest.mark.parametrize(
    "photo",
    [
        "https://example.test/a.jpg",
        "data:image/svg+xml,<svg/>",
        "data:image/jpeg;base64,",
        "data:image/jpeg;base64,!!!!",
        PHOTO[:-3],
        PHOTO + "A" * 50000,
    ],
    ids=["url", "svg", "empty", "base64", "truncated", "oversized"],
)
def test_invalid_photo_rejected(photo):
    with pytest.raises(AccessError, match="invalid_photo"):
        photo_value(photo)


@pytest.mark.parametrize(
    "patch",
    [
        {"profile": []},
        {"profile": {"../x": "value"}},
        {"profile": {"field": "x" * 101}},
        {"group_ids": ["team", "team"]},
        {"photo": "not-an-image"},
    ],
)
async def test_invalid_profile_does_not_change_user(patch):
    repo = AccessRepository(AsyncMock())
    user = await repo.async_create({"display_name": "Demo"})
    with pytest.raises(AccessError):
        await repo.async_update(user.id, patch, expected_revision=1)
    assert repo.get(user.id).revision == 1


async def test_photo_removal_keeps_user_and_profile_and_rejects_stale_edit():
    repo = AccessRepository(AsyncMock())
    user = await repo.async_create(
        {"display_name": "Demo", "photo": PHOTO, "profile": {"dept": "Staff"}}
    )
    removed = await repo.async_update(user.id, {"photo": None}, expected_revision=1)
    assert not removed.public()["photo_configured"] and removed.profile == {"dept": "Staff"}
    with pytest.raises(AccessError, match="revision_conflict"):
        await repo.async_update(user.id, {"photo": PHOTO}, expected_revision=1)


@pytest.mark.parametrize("initially_synced", [True, False])
async def test_profile_only_edit_then_reconcile_has_no_extra_device_writes(initially_synced):
    import httpx
    from test_access_engine import CAP, Device

    from custom_components.hikvision_intercom.access.engine import SyncEngine
    from custom_components.hikvision_intercom.client.access import AccessClient
    from custom_components.hikvision_intercom.client.client import (
        ConnectionSettings,
        HikvisionClient,
    )

    device = Device()
    repo = AccessRepository(AsyncMock())
    engine = SyncEngine(repo)
    user = await repo.async_create(
        {"display_name": "Demo", "assignments": {"station": {"allowed_locks": [1]}}}
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(device.handle)) as session:
        driver = AccessClient(
            HikvisionClient(
                session,
                ConnectionSettings("device.test", "demo", "secret"),
                enabled_doors=frozenset({1}),
            )
        )
        driver.capabilities = CAP
        if initially_synced:
            result = await engine.async_reconcile("station", driver)
            assert not result.failed
        before = len(device.writes)
        updated = await repo.async_update(
            user.id, {"profile": {"department": "Staff"}}, expected_revision=user.revision
        )
        assignment = updated.assignments["station"]
        assert assignment.desired_revision == updated.revision
        assert (assignment.applied_revision == updated.revision) is initially_synced
        for _ in range(2):
            result = await engine.async_reconcile("station", driver)
            assert not result.failed
        current = repo.get(user.id).assignments["station"]
        assert (
            current.sync_state == "synced" and current.applied_revision == current.desired_revision
        )
        assert len(device.writes) - before == (0 if initially_synced else 1)
