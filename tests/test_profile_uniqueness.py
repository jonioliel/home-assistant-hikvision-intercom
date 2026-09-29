"""Unique custom values are retained across archive and committed atomically."""

import asyncio
from copy import deepcopy
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.access.manager import AccessManager
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.profile_settings import ProfileSettings, normalize


async def setup(unique=True, kind="text"):
    repo = AccessRepository(AsyncMock())
    await repo.async_load(None)
    settings = ProfileSettings(repo.async_profile_settings, lambda: None, repo.profile_settings)
    await settings.update(
        0,
        {
            "fields": [
                {
                    "id": "external",
                    "label": "External identity",
                    "enabled": True,
                    "options": [],
                    "type": kind,
                    "unique": unique,
                }
            ],
            "groups": [],
            "photo_enabled": False,
        },
    )
    return repo, settings


@pytest.mark.parametrize(
    "kind,first,second",
    [
        ("text", "Example", " example "),
        ("text", "ＡＢＣ", "abc"),
        ("number", "1.00", "1"),
        ("number", "0", "-0.0"),
    ],
)
async def test_canonical_duplicates_are_rejected_without_state_change(kind, first, second):
    repo, _ = await setup(kind=kind)
    await repo.async_create({"display_name": "First", "profile": {"external": first}})
    before = repo.snapshot()
    with pytest.raises(AccessError, match="profile_value_not_unique"):
        await repo.async_create({"display_name": "Second", "profile": {"external": second}})
    assert repo.snapshot() == before


async def test_archived_identity_keeps_value_reserved_and_restore_inactive():
    repo, _ = await setup()
    user = await repo.async_create({"display_name": "First", "profile": {"external": "A-17"}})
    archived = await repo.async_archive(user.id, archived=True, expected_revision=user.revision)
    with pytest.raises(AccessError, match="profile_value_not_unique"):
        await repo.async_create({"display_name": "Second", "profile": {"external": "a-17"}})
    restored = await repo.async_archive(
        user.id, archived=False, expected_revision=archived.revision
    )
    assert not restored.active and restored.profile == user.profile
    disabled = await repo.async_update(
        user.id, {"active": False}, expected_revision=restored.revision
    )
    assert not disabled.active


async def test_blank_optional_values_are_not_reserved():
    repo, _ = await setup()
    for value in ("", ""):
        await repo.async_create({"display_name": "Example", "profile": {"external": value}})
    assert len(repo.users()) == 2


async def test_enabling_unique_with_existing_duplicates_is_reviewed_but_blocked():
    repo, settings = await setup(unique=False)
    for value in ("secret_same", "SECRET_SAME"):
        await repo.async_create({"display_name": "Example", "profile": {"external": value}})
    manager = AccessManager(repo)
    try:
        values = settings.public()
        revision = values.pop("revision")
        values["fields"][0]["unique"] = True
        before = repo.snapshot()
        review = await manager.policy.preview("admin", revision, values)
        assert review["requires_confirmation"] and not review["can_apply"]
        assert review["field_changes"][0]["duplicates"] == 2
        assert "secret_same" not in str(review).casefold()
        with pytest.raises(AccessError, match="profile_value_not_unique"):
            await manager.policy.apply("admin", review["operation_id"])
        assert repo.snapshot() == before
        with pytest.raises(AccessError, match="profile_value_not_unique"):
            await settings.update(revision, values)
        assert repo.snapshot() == before
    finally:
        await manager.async_close()


async def test_bulk_duplicate_updates_never_partially_save():
    repo, _ = await setup()
    users = [
        await repo.async_create({"display_name": "Example", "profile": {"external": value}})
        for value in ("A", "B")
    ]
    manager = AccessManager(repo)
    try:
        before = repo.snapshot()
        with pytest.raises(AccessError, match="profile_value_not_unique"):
            await manager.bulk.preview(
                "admin",
                {
                    "action": "profile",
                    "selection": [{"user_id": u.id, "revision": u.revision} for u in users],
                    "profile": {"external": "C"},
                },
            )
        assert repo.snapshot() == before
    finally:
        await manager.async_close()


async def test_parallel_creates_allow_only_one_owner():
    repo, _ = await setup()
    results = await asyncio.gather(
        *[
            repo.async_create({"display_name": "Example", "profile": {"external": "same"}})
            for _ in range(2)
        ],
        return_exceptions=True,
    )
    assert sum(isinstance(value, AccessError) for value in results) == 1
    assert len(repo.users()) == 1


async def test_reload_and_old_client_preserve_unique_and_failed_save_is_atomic():
    repo, settings = await setup()
    user = await repo.async_create({"display_name": "Example", "profile": {"external": "A"}})
    old = settings.public()
    revision = old.pop("revision")
    old["fields"][0].pop("unique")
    old["fields"][0]["label"] = "Renamed"
    await settings.update(revision, old)
    assert settings.public()["fields"][0]["unique"]
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    assert restored.profile_settings()["schema"] == 3
    with pytest.raises(AccessError, match="profile_value_not_unique"):
        await restored.async_create({"display_name": "New", "profile": {"external": "a"}})
    before = repo.snapshot()
    repo._save.side_effect = OSError("disk full")
    with pytest.raises(OSError):
        await repo.async_update(
            user.id, {"profile": {"external": "B"}}, expected_revision=user.revision
        )
    assert repo.snapshot() == before


async def test_corrupt_unique_storage_fails_closed():
    repo, _ = await setup(unique=False)
    for value in ("A", "a"):
        await repo.async_create({"display_name": "Example", "profile": {"external": value}})
    corrupt = deepcopy(repo.snapshot())
    corrupt["profile_settings"]["values"]["fields"][0]["unique"] = True
    restored = AccessRepository(AsyncMock())
    with pytest.raises(AccessError):
        await restored.async_load(corrupt)
    assert not restored.users()


@pytest.mark.parametrize("invalid", [1, "true", None])
async def test_unique_flag_requires_boolean(invalid):
    _, settings = await setup()
    values = settings.public()
    values.pop("revision")
    values["fields"][0]["unique"] = invalid
    with pytest.raises(AccessError, match="invalid_fields"):
        normalize(values)


async def test_reviewed_uniqueness_enables_without_changing_people():
    repo, settings = await setup(unique=False)
    user = await repo.async_create({"display_name": "Example", "profile": {"external": "A"}})
    manager = AccessManager(repo)
    try:
        values = settings.public()
        revision = values.pop("revision")
        values["fields"][0]["unique"] = True
        review = await manager.policy.preview("admin", revision, values)
        assert review["requires_confirmation"] and review["can_apply"]
        await manager.policy.apply("admin", review["operation_id"])
        assert settings.public()["fields"][0]["unique"]
        assert repo.get(user.id).profile == user.profile
        with pytest.raises(AccessError, match="profile_value_not_unique"):
            await repo.async_create({"display_name": "Second", "profile": {"external": "a"}})
    finally:
        await manager.async_close()


async def test_type_change_can_introduce_numeric_collision_and_is_blocked():
    repo, settings = await setup()
    for value in ("1", "1.00"):
        await repo.async_create({"display_name": "Example", "profile": {"external": value}})
    manager = AccessManager(repo)
    try:
        values = settings.public()
        revision = values.pop("revision")
        values["fields"][0]["type"] = "number"
        review = await manager.policy.preview("admin", revision, values)
        assert not review["can_apply"] and review["field_changes"][0]["duplicates"] == 2
    finally:
        await manager.async_close()


async def test_deletion_keeps_cleanup_but_erases_local_metadata_and_frees_its_value():
    repo, _ = await setup()
    user = await repo.async_create(
        {
            "display_name": "Example",
            "profile": {"external": "A"},
            "assignments": {"a": {"allowed_locks": [1]}},
        }
    )
    await repo.async_delete(user.id, expected_revision=user.revision)
    assert user.id in repo.snapshot()["tombstones"]
    assert repo.snapshot()["tombstones"][user.id]["record"]["profile"] == {}
    second = await repo.async_create({"display_name": "New", "profile": {"external": "a"}})
    assert second.profile["external"] == "a"
