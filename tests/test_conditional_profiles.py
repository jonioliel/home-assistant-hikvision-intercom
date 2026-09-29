"""Conditional rules enforce writes without destroying retained data or authority."""

import json
from copy import deepcopy
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.access.manager import AccessManager
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.operator_scope import guard_fields, project_profiles
from custom_components.hikvision_intercom.panel_permissions import AREAS, normalize_policy
from custom_components.hikvision_intercom.profile_settings import ProfileSettings


def definitions(*, required=True, unique=False):
    return {
        "fields": [
            {"id": "role", "label": "Role", "enabled": True, "options": []},
            {
                "id": "badge",
                "label": "Badge",
                "enabled": True,
                "options": [],
                "required": required,
                "type": "number",
                "unique": unique,
                "depends_on": {"field_id": "role", "value": "staff"},
            },
            {
                "id": "note",
                "label": "Note",
                "enabled": True,
                "options": [],
                "depends_on": {"field_id": "badge", "value": "2"},
            },
        ],
        "groups": [],
        "photo_enabled": False,
    }


@pytest.fixture
async def conditional():
    repo = AccessRepository(AsyncMock())
    await repo.async_load(None)
    settings = ProfileSettings(repo.async_profile_settings, lambda: None, repo.profile_settings)
    await settings.update(0, definitions())
    manager = AccessManager(repo)
    yield repo, settings, manager
    await manager.async_close()


@pytest.mark.parametrize(
    "value,code", [("", "profile_required"), ("legacy", "profile_value_invalid")]
)
async def test_activation_requires_completing_newly_active_child_atomically(
    conditional, value, code
):
    repo, _, _ = conditional
    user = await repo.async_create(
        {"display_name": "Guest", "profile": {"role": "visitor", "badge": value}}
    )
    before = repo.snapshot()
    with pytest.raises(AccessError, match=code):
        await repo.async_update(
            user.id, {"profile": {**user.profile, "role": "staff"}}, expected_revision=user.revision
        )
    assert repo.snapshot() == before
    activated = await repo.async_update(
        user.id,
        {"profile": {**user.profile, "role": "staff", "badge": "2"}},
        expected_revision=user.revision,
    )
    assert activated.profile["badge"] == "2"
    disabled = await repo.async_update(
        user.id,
        {"profile": {**activated.profile, "role": "visitor"}},
        expected_revision=activated.revision,
    )
    assert disabled.profile["badge"] == "2"


async def test_new_person_and_archived_values_preserve_condition_rules_on_restart(conditional):
    repo, _, _ = conditional
    with pytest.raises(AccessError, match="profile_required"):
        await repo.async_create({"display_name": "Staff", "profile": {"role": "staff"}})
    guest = await repo.async_create(
        {"display_name": "Guest", "profile": {"role": "visitor", "badge": "old"}}
    )
    await repo.async_archive(guest.id, archived=True, expected_revision=guest.revision)
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    assert restored.get(guest.id).profile["badge"] == "old"
    assert restored.profile_settings()["schema"] == 4
    assert restored.profile_settings()["values"]["fields"][1]["depends_on"]["field_id"] == "role"


async def test_old_client_omission_preserves_rules_but_null_explicitly_clears(conditional):
    repo, settings, manager = conditional
    await repo.async_create(
        {"display_name": "Guest", "profile": {"role": "visitor", "badge": "legacy"}}
    )
    old = settings.public()
    revision = old.pop("revision")
    for field in old["fields"]:
        field.pop("depends_on")
    old["fields"][0]["label"] = "Category"
    await settings.update(revision, old)
    assert settings.public()["fields"][1]["depends_on"]["value"] == "staff"
    desired = settings.public()
    revision = desired.pop("revision")
    desired["fields"][1]["depends_on"] = None
    review = await manager.policy.preview("admin", revision, desired)
    row = next(r for r in review["field_changes"] if r["field_id"] == "badge")
    assert row["newly_applicable"] == 1 and row["invalid"] == 1
    await manager.policy.apply("admin", review["operation_id"])
    user = repo.users()[0]
    revoked = await repo.async_update(
        user.id, {"active": False, "profile": user.profile}, expected_revision=user.revision
    )
    assert not revoked.active and revoked.profile["badge"] == "legacy"


async def test_ancestor_change_is_reviewed_for_descendants_and_templates(conditional):
    repo, settings, manager = conditional
    await repo.async_create({"display_name": "Staff", "profile": {"role": "staff", "badge": "2"}})
    desired = settings.public()
    revision = desired.pop("revision")
    desired["fields"][0]["enabled"] = False
    desired["templates"] = [
        {
            "id": "staff",
            "label": "Staff",
            "enabled": True,
            "profile": {"role": "staff", "badge": "invalid"},
            "group_ids": [],
        }
    ]
    review = await manager.policy.preview("admin", revision, desired)
    rows = {row["field_id"]: row for row in review["field_changes"]}
    assert set(rows) == {"role", "badge", "note"}
    assert rows["badge"]["applicable"] == 0 and rows["badge"]["inactive"] == 1
    assert rows["badge"]["template_issues"] == 0


async def test_condition_save_failure_and_future_schema_do_not_mutate(conditional):
    repo, settings, manager = conditional
    desired = settings.public()
    revision = desired.pop("revision")
    desired["fields"][1]["depends_on"]["value"] = "member"
    review = await manager.policy.preview("admin", revision, desired)
    before = repo.snapshot()
    repo._save.side_effect = OSError("disk")
    with pytest.raises(OSError):
        await manager.policy.apply("admin", review["operation_id"])
    assert repo.snapshot() == before
    future = deepcopy(settings.data)
    future["schema"] = 5
    with pytest.raises(AccessError, match="invalid_storage"):
        settings.load(future)
    assert repo.snapshot() == before


async def test_inactive_unique_values_remain_reserved(conditional):
    repo, settings, manager = conditional
    desired = settings.public()
    revision = desired.pop("revision")
    desired["fields"][1]["unique"] = True
    review = await manager.policy.preview("admin", revision, desired)
    await manager.policy.apply("admin", review["operation_id"])
    await repo.async_create({"display_name": "Guest", "profile": {"role": "visitor", "badge": "2"}})
    with pytest.raises(AccessError, match="profile_value_not_unique"):
        await repo.async_create(
            {"display_name": "Staff", "profile": {"role": "staff", "badge": "2.00"}}
        )


def test_hidden_ancestor_is_unknown_readonly_and_does_not_disclose_predicate():
    policy = normalize_policy(
        {
            "enabled": True,
            "areas": dict.fromkeys(AREAS, "manage"),
            "profile_fields": {"role": "none"},
        }
    )
    fields = definitions()
    before = deepcopy(fields)
    projected = project_profiles(policy, fields)
    assert [f["id"] for f in projected["fields"]] == ["badge", "note"]
    assert all(f["applicability_unknown"] and "depends_on" not in f for f in projected["fields"])
    assert "staff" not in json.dumps(projected) and fields == before
    for child in ("badge", "note"):
        with pytest.raises(AccessError, match="field_access_denied"):
            guard_fields(policy, {"profile": {child: "2"}}, fields)
    guard_fields(policy, {"display_name": "New"}, fields)


async def test_csv_and_bulk_activation_validate_before_commit(conditional):
    repo, _, manager = conditional
    user = await repo.async_create({"display_name": "Guest", "profile": {"role": "visitor"}})
    before = repo.snapshot()
    raw = "employee_no,display_name,profile:role\n" + user.employee_no + ',Guest,"staff"\n'
    review = await manager.async_preview_csv(raw, "upsert")
    assert review["errors"] and "profile_required" in str(review["errors"])
    with pytest.raises(AccessError, match="profile_required"):
        await manager.bulk.preview(
            "admin",
            {
                "action": "profile",
                "profile": {"role": "staff"},
                "selection": [{"user_id": user.id, "revision": user.revision}],
            },
        )
    assert repo.snapshot() == before
