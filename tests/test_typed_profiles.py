"""Typed profile migration and onboarding defaults cannot weaken access operations."""

from copy import deepcopy
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.profile_settings import ProfileSettings, normalize


@pytest.fixture
async def typed():
    repo = AccessRepository(AsyncMock())
    await repo.async_load(None)
    policy = ProfileSettings(repo.async_profile_settings, lambda: None, repo.profile_settings)
    await policy.update(
        0,
        {
            "photo_enabled": False,
            "groups": [],
            "fields": [
                {
                    "id": "department",
                    "label": "Department",
                    "enabled": True,
                    "type": "select",
                    "required": True,
                    "options": ["Staff", "Maintenance"],
                },
                {
                    "id": "floor",
                    "label": "Floor",
                    "enabled": True,
                    "type": "number",
                    "required": False,
                    "options": [],
                },
                {
                    "id": "arrival",
                    "label": "Arrival",
                    "enabled": True,
                    "type": "date",
                    "required": False,
                    "options": [],
                },
            ],
        },
    )
    return repo, policy


@pytest.mark.parametrize(
    "profile",
    [
        {},
        {"department": "Unknown"},
        {"department": "Staff", "floor": "nan"},
        {"department": "Staff", "floor": "1e10"},
        {"department": "Staff", "arrival": "2026-02-29"},
    ],
)
async def test_new_invalid_profile_never_saves(typed, profile):
    repo, _ = typed
    before = repo.snapshot()
    with pytest.raises(AccessError):
        await repo.async_create({"display_name": "Example", "profile": profile})
    assert repo.snapshot() == before


async def test_typed_legacy_values_survive_rename_revoke_and_restart(typed):
    repo, policy = typed
    user = await repo.async_create(
        {
            "display_name": "Example",
            "profile": {"department": "Staff", "floor": "2.5", "arrival": "2028-02-29"},
        }
    )
    values = policy.public()
    revision = values.pop("revision")
    values["fields"][0]["options"] = ["Maintenance"]
    await policy.update(revision, values)
    updated = await repo.async_update(
        user.id, {"active": False, "profile": dict(user.profile)}, expected_revision=user.revision
    )
    assert updated.profile["department"] == "Staff" and not updated.active
    with pytest.raises(AccessError, match="profile_required"):
        await repo.async_update(
            user.id,
            {"profile": {**user.profile, "department": ""}},
            expected_revision=updated.revision,
        )
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    assert restored.get(user.id).profile == updated.profile


async def test_old_client_cannot_erase_types_templates_or_required(typed):
    _, policy = typed
    values = policy.public()
    revision = values.pop("revision")
    values["templates"] = [
        {
            "id": "staff",
            "label": "Staff",
            "enabled": True,
            "profile": {"department": "Staff"},
            "group_ids": [],
        }
    ]
    await policy.update(revision, values)
    old = policy.public()
    revision = old.pop("revision")
    old.pop("templates")
    for f in old["fields"]:
        f.pop("type")
        f.pop("required")
    old["fields"][0]["label"] = "Team"
    await policy.update(revision, old)
    assert policy.public()["fields"][0]["type"] == "select"
    assert policy.public()["fields"][0]["required"]
    assert policy.public()["templates"][0]["id"] == "staff"
    assert policy.data["schema"] == 2


@pytest.mark.parametrize(
    "extra", [{"pin": "123456"}, {"photo": "data:x"}, {"cards": []}, {"employee_no": "123"}]
)
async def test_templates_never_accept_identity_or_credentials(typed, extra):
    _, policy = typed
    values = policy.public()
    values.pop("revision")
    values["templates"] = [
        {"id": "staff", "label": "Staff", "enabled": True, "profile": {}, "group_ids": [], **extra}
    ]
    with pytest.raises(AccessError):
        normalize(values)


async def test_profile_schema_one_upgrades_without_inventing_requirements():
    original = {
        "schema": 1,
        "revision": 7,
        "values": {
            "photo_enabled": False,
            "groups": [],
            "fields": [{"id": "field", "label": "Field", "enabled": True, "options": []}],
        },
    }
    saved = deepcopy(original)
    policy = ProfileSettings(AsyncMock(), lambda: None)
    policy.load(original)
    assert original == saved and policy.data["schema"] == 2 and policy.public()["revision"] == 7
    assert (
        policy.public()["fields"][0]["type"] == "text"
        and not policy.public()["fields"][0]["required"]
    )
