"""Policy changes are reviewed without converting values or blocking revocation."""

import json
from copy import deepcopy
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.access.manager import AccessManager
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.profile_impact import field_impact
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.profile_settings import ProfileSettings


@pytest.fixture
async def people():
    repo = AccessRepository(AsyncMock())
    await repo.async_load(None)
    settings = ProfileSettings(repo.async_profile_settings, lambda: None, repo.profile_settings)
    await settings.update(
        0,
        {
            "fields": [{"id": "room", "label": "Room", "enabled": True, "options": []}],
            "groups": [],
            "photo_enabled": False,
        },
    )
    users = []
    for value in ("secret_legacy_value", "42", ""):
        users.append(
            await repo.async_create({"display_name": "Resident", "profile": {"room": value}})
        )
    await repo.async_archive(users[0].id, archived=True, expected_revision=users[0].revision)
    manager = AccessManager(repo)
    yield manager, settings, users
    await manager.async_close()


def proposed(settings, **field):
    data = settings.public()
    revision = data.pop("revision")
    data["fields"][0].update(field)
    return revision, data


async def test_review_is_readonly_bounded_and_excludes_raw_values(people):
    manager, settings, _ = people
    revision, values = proposed(settings, type="number", required=True)
    before = manager.repository.snapshot()
    review = await manager.policy.preview("admin", revision, values)
    assert manager.repository.snapshot() == before and review["device_writes"] == 0
    assert review["requires_confirmation"] and review["stations"] == []
    row = review["field_changes"][0]
    assert (row["checked"], row["missing"], row["invalid"], row["previous_issues"]) == (3, 1, 1, 0)
    assert row["examples"][0]["archived"]
    assert "secret_legacy_value" not in json.dumps(review)


async def test_reviewed_change_preserves_values_and_disable_path(people):
    manager, settings, users = people
    revision, values = proposed(settings, type="date", required=True)
    review = await manager.policy.preview("admin", revision, values)
    receipt = await manager.policy.apply("admin", review["operation_id"])
    assert receipt["changed"] == 0
    assert await manager.policy.apply("admin", review["operation_id"]) == receipt
    assert manager.repository.get(users[0].id).profile == {"room": "secret_legacy_value"}
    user = manager.repository.get(users[1].id)
    disabled = await manager.repository.async_update(
        user.id, {"active": False, "profile": user.profile}, expected_revision=user.revision
    )
    assert not disabled.active and disabled.profile == user.profile
    with pytest.raises(AccessError, match="profile_value_invalid"):
        await manager.repository.async_update(
            user.id, {"profile": {"room": "wrong"}}, expected_revision=disabled.revision
        )


async def test_review_fails_if_values_changed_after_preview(people):
    manager, settings, users = people
    revision, values = proposed(settings, required=True)
    review = await manager.policy.preview("admin", revision, values)
    await manager.repository.async_update(
        users[1].id, {"profile": {"room": "43"}}, expected_revision=users[1].revision
    )
    before = manager.repository.snapshot()
    with pytest.raises(AccessError, match="bulk_review_stale"):
        await manager.policy.apply("admin", review["operation_id"])
    assert manager.repository.snapshot() == before


async def test_save_failure_keeps_original_policy_and_values(people):
    manager, settings, _ = people
    revision, values = proposed(settings, type="number")
    review = await manager.policy.preview("admin", revision, values)
    before = manager.repository.snapshot()
    manager.repository._save.side_effect = OSError("disk full")
    with pytest.raises(OSError):
        await manager.policy.apply("admin", review["operation_id"])
    assert manager.repository.snapshot() == before


async def test_rename_and_text_suggestions_preserve_old_client_behavior(people):
    manager, settings, _ = people
    revision, values = proposed(settings, label="Apartment", options=["101"])
    for field in values["fields"]:
        field.pop("type")
        field.pop("required")
    review = await manager.policy.preview("admin", revision, values)
    assert not review["requires_confirmation"] and review["field_changes"] == []


async def test_select_options_and_enabled_templates_are_checked(people):
    manager, settings, _ = people
    revision, values = proposed(settings, type="select", options=["42"])
    values["templates"] = [
        {
            "id": "example",
            "label": "Example",
            "enabled": True,
            "profile": {"room": "Unknown"},
            "group_ids": [],
        }
    ]
    review = await manager.policy.preview("admin", revision, values)
    row = review["field_changes"][0]
    assert row["invalid"] == 1 and row["missing"] == 0 and row["template_issues"] == 1
    assert row["before"]["type"] == "text" and row["after"]["options"] == ["42"]


async def test_examples_are_bounded_but_totals_are_complete(people):
    manager, settings, _ = people
    prior = manager.repository.profile_settings()
    after = deepcopy(prior)
    after["values"]["fields"][0].update(type="date")
    raw = manager.repository.snapshot()["users"]
    user = deepcopy(next(iter(raw.values())))
    users = {str(i): {**user, "id": str(i)} for i in range(35)}
    rows = field_impact(prior, after, users)
    assert rows[0]["invalid"] == 35 and len(rows[0]["examples"]) == 20
    assert rows[0]["examples_truncated"]
