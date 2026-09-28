"""Visit presets stay durable and isolated from users, credentials and hardware."""

import asyncio
from copy import deepcopy
from unittest.mock import AsyncMock, Mock

import pytest

from custom_components.hikvision_intercom.access.guest_templates import GuestTemplates, normalize
from custom_components.hikvision_intercom.access.models import AccessError


def values(**patch):
    return {
        "label": "Maintenance visit",
        "access_category": "contractor",
        "responsible_person": "Facilities",
        "access_purpose": "Inspection",
        "duration_minutes": 180,
        "doors": {"front": [2, 1], "rear": [1]},
        "weekly_timing": {
            "mode": "weekly",
            "timezone": "Asia/Jerusalem",
            "days": ["Thursday", "Monday"],
            "dates": [],
            "periods": [{"start": "12:00", "end": "18:00"}],
        },
        **patch,
    }


async def test_create_edit_delete_roundtrip_preserves_safe_metadata_and_no_op():
    save, changed = AsyncMock(), Mock()
    library = GuestTemplates(save, changed)
    result = await library.upsert(0, "", values(), "operator")
    item = result["items"][0]
    assert len(item["id"]) == 32 and item["updated_by"] == "operator"
    assert item["doors"] == {"front": [1, 2], "rear": [1]}
    assert item["weekly_timing"]["days"] == ["Monday", "Thursday"]
    assert set(item) == set(values()) | {"id", "updated_at", "updated_by"}
    save.assert_awaited_once()
    await library.upsert(1, item["id"], values(), "other-operator")
    save.assert_awaited_once()
    assert library.public()["items"][0]["updated_by"] == "operator"
    updated = await library.upsert(1, item["id"], values(duration_minutes=120), "operator-2")
    assert updated["revision"] == 2 and updated["items"][0]["updated_by"] == "operator-2"
    restored = GuestTemplates(AsyncMock(), Mock())
    restored.load(save.await_args.args[0])
    assert restored.public() == updated
    result["items"][0]["doors"]["front"].clear()
    assert library.public()["items"][0]["doors"]["front"] == [1, 2]
    assert (await restored.delete(2, item["id"])) == {"revision": 3, "items": []}


@pytest.mark.parametrize(
    "patch",
    [
        {"label": " "},
        {"label": "Bad\nlabel"},
        {"access_category": "staff"},
        {"responsible_person": ""},
        {"duration_minutes": True},
        {"duration_minutes": 14},
        {"duration_minutes": 43201},
        {"duration_minutes": 60.5},
        {"doors": {}},
        {"doors": {"front": [True]}},
        {"doors": {"front": [1, 1]}},
        {"doors": {"front": [3]}},
        {"doors": {"front": []}},
        {"doors": {"../front": [1]}},
        {"doors": {"front": "1"}},
        {"pin": "123456"},
        {"cards": []},
        {"id": "forged"},
    ],
)
def test_invalid_or_credential_bearing_templates_are_rejected(patch):
    with pytest.raises(AccessError, match="invalid_fields"):
        normalize(values(**patch))


@pytest.mark.parametrize(
    "weekly",
    [
        {
            "mode": "dates",
            "timezone": "UTC",
            "days": [],
            "dates": ["2026-09-28"],
            "periods": [{"start": "00:00", "end": "24:00"}],
        },
        {
            "mode": "weekly",
            "timezone": "Unknown/Zone",
            "days": ["Monday"],
            "dates": [],
            "periods": [{"start": "12:00", "end": "18:00"}],
        },
        {
            "mode": "weekly",
            "timezone": "UTC",
            "days": ["Monday"],
            "dates": [],
            "periods": [{"start": "12:00", "end": "18:00"}, {"start": "17:00", "end": "19:00"}],
        },
    ],
)
def test_template_never_flattens_invalid_recurring_windows(weekly):
    with pytest.raises(AccessError):
        normalize(values(weekly_timing=weekly))


async def test_revision_and_failed_storage_do_not_publish():
    save, changed = AsyncMock(), Mock()
    library = GuestTemplates(save, changed)
    created = await library.upsert(0, "", values(), "operator")
    identity = created["items"][0]["id"]
    with pytest.raises(AccessError, match="revision_conflict"):
        await library.upsert(True, identity, values(), "operator")
    with pytest.raises(AccessError, match="guest_template_not_found"):
        await library.upsert(1, "unknown", values(), "operator")
    with pytest.raises(AccessError, match="revision_conflict"):
        await library.delete(0, identity)
    save.side_effect = OSError("Synthetic disk failure")
    with pytest.raises(OSError):
        await library.delete(1, identity)
    assert library.public() == created
    changed.assert_called_once()


async def test_concurrent_editor_has_one_winner_and_delete_cannot_erase_new_revision():
    library = GuestTemplates(AsyncMock(), Mock())
    created = await library.upsert(0, "", values(), "operator")
    identity = created["items"][0]["id"]
    results = await asyncio.gather(
        library.upsert(1, identity, values(duration_minutes=240), "operator"),
        library.delete(1, identity),
        return_exceptions=True,
    )
    assert sum(isinstance(result, AccessError) for result in results) == 1
    assert library.public()["revision"] == 2


async def test_repeated_cancellation_cannot_interrupt_durable_commit_or_unlock_early():
    started, release = asyncio.Event(), asyncio.Event()
    saved = []

    async def save(data):
        started.set()
        await release.wait()
        saved.append(deepcopy(data))

    library = GuestTemplates(save, Mock())
    task = asyncio.create_task(library.upsert(0, "", values(), "operator"))
    await started.wait()
    task.cancel()
    await asyncio.sleep(0)
    task.cancel()
    await asyncio.sleep(0)
    assert not task.done() and library.public()["revision"] == 0
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert library.public()["revision"] == saved[0]["revision"] == 1
    assert (await library.upsert(1, "", values(label="Next"), "operator"))["revision"] == 2


async def test_limit_and_corrupt_storage_are_fail_closed(monkeypatch):
    library = GuestTemplates(AsyncMock(), Mock())
    await library.upsert(0, "", values(), "operator")
    snapshot = {"schema": 1, **library.public()}
    for corrupt in [
        {**snapshot, "schema": True},
        {**snapshot, "revision": True},
        {**snapshot, "pin": "secret"},
        {**snapshot, "items": snapshot["items"] * 2},
        {**snapshot, "items": [{**snapshot["items"][0], "updated_at": "2026-09-28"}]},
    ]:
        with pytest.raises(AccessError, match="invalid_storage"):
            library.load(corrupt)
        assert library.public() == {
            key: value for key, value in snapshot.items() if key != "schema"
        }
    monkeypatch.setattr(
        "custom_components.hikvision_intercom.access.guest_templates.MAX_TEMPLATES", 1
    )
    with pytest.raises(AccessError, match="guest_template_limit"):
        await library.upsert(1, "", values(label="Second"), "operator")
