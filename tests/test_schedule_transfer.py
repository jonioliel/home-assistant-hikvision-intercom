"""Portable drafts: atomic append, strict validation and actor-bound one-use review."""

import asyncio
import json
from unittest.mock import AsyncMock, patch

import pytest
from test_schedules import draft

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.schedules import (
    TRANSFER_FORMAT,
    ScheduleLibrary,
    transfer_document,
)


def document(items=None):
    return json.dumps({"format": TRANSFER_FORMAT, "version": 1, "schedules": items or [draft()]})


async def test_export_roundtrip_only_portable_fields_and_atomic_new_ids():
    save = AsyncMock()
    library = ScheduleLibrary(save)
    original = await library.async_save(draft())
    exported = library.export()
    assert set(exported["schedules"][0]) == {"name", "weekly", "holidays"}
    assert original["id"] not in json.dumps(exported)
    preview = library.preview_import(json.dumps(exported), "admin")
    assert preview["name_collisions"] == 1 and save.await_count == 1
    added = await library.async_import(preview["token"], "admin")
    assert save.await_count == 2 and len(library.list()) == 2
    assert added[0]["id"] != original["id"] and added[0]["revision"] == 1
    added[0]["name"] = "Mutated result"
    assert library.list()[0]["name"] == "Office"
    with pytest.raises(AccessError, match="schedule_import_expired"):
        await library.async_import(preview["token"], "admin")


@pytest.mark.parametrize(
    "content",
    [
        "{",
        '{"format":"x","format":"y"}',
        '{"format":"hikvision_intercom.schedule_drafts","version":true,"schedules":[]}',
        "[]",
        "null",
        "[" * 2000,
        "x" * (8 * 1024 * 1024 + 1),
    ],
    ids=["broken", "duplicate_keys", "boolean_version", "array", "null", "depth", "oversized"],
)
def test_malformed_document_rejected_without_echo(content):
    with pytest.raises(AccessError, match="schedule_transfer_invalid"):
        transfer_document(content)


async def test_bad_member_rejects_whole_batch_before_preview_and_capacity_check():
    library = ScheduleLibrary(AsyncMock())
    bad = draft()
    bad["station_id"] = "PRIVATE_STATION"
    with pytest.raises(AccessError, match="invalid_fields"):
        library.preview_import(document([draft(), bad]), "a")
    assert not library.list() and not library._imports
    await library.async_save(draft())
    with pytest.raises(AccessError, match="schedule_limit"):
        library.preview_import(document([draft() for _ in range(100)]), "a")
    assert len(library.list()) == 1


async def test_preview_bound_to_actor_expiry_library_and_latest_review():
    library = ScheduleLibrary(AsyncMock())
    first = library.preview_import(document(), "a")
    with pytest.raises(AccessError, match="schedule_import_expired"):
        await library.async_import(first["token"], "b")
    second = library.preview_import(document(), "a")
    with pytest.raises(AccessError, match="schedule_import_expired"):
        await library.async_import(first["token"], "a")
    await library.async_save(draft())
    with pytest.raises(AccessError, match="revision_conflict"):
        await library.async_import(second["token"], "a")
    with patch("custom_components.hikvision_intercom.access.schedules.monotonic", return_value=0):
        third = library.preview_import(document(), "a")
    with (
        patch("custom_components.hikvision_intercom.access.schedules.monotonic", return_value=301),
        pytest.raises(AccessError, match="schedule_import_expired"),
    ):
        await library.async_import(third["token"], "a")


async def test_failed_persistence_keeps_all_originals_and_requires_fresh_review():
    save = AsyncMock()
    library = ScheduleLibrary(save)
    original = await library.async_save(draft())
    preview = library.preview_import(document([draft(), draft()]), "a")
    save.side_effect = OSError("private failure")
    with pytest.raises(OSError):
        await library.async_import(preview["token"], "a")
    assert library.list() == [original]
    with pytest.raises(AccessError, match="schedule_import_expired"):
        await library.async_import(preview["token"], "a")


async def test_cancelled_save_finishes_entire_batch_once():
    started, finish = asyncio.Event(), asyncio.Event()

    async def save(state):
        assert len(state["schedules"]) == 2
        started.set()
        await finish.wait()

    library = ScheduleLibrary(save)
    preview = library.preview_import(document([draft(), draft()]), "a")
    task = asyncio.create_task(library.async_import(preview["token"], "a"))
    await started.wait()
    assert library.list() == []
    task.cancel()
    finish.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(library.list()) == 2
    with pytest.raises(AccessError, match="schedule_import_expired"):
        await library.async_import(preview["token"], "a")


async def test_simultaneous_reviews_cannot_overwrite_or_append_twice():
    library = ScheduleLibrary(AsyncMock())
    a, b = (library.preview_import(document(), actor) for actor in ("a", "b"))
    result = await asyncio.gather(
        library.async_import(a["token"], "a"),
        library.async_import(b["token"], "b"),
        return_exceptions=True,
    )
    assert sum(isinstance(r, AccessError) for r in result) == 1
    assert len(library.list()) == 1
