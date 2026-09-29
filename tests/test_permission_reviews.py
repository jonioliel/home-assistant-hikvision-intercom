"""Periodic reviews are scoped, immutable and atomic; no admission data changes."""

import asyncio
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, Mock

import pytest

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.permission_reviews import (
    PermissionReviews,
)

NOW = datetime(2026, 9, 29, 12, tzinfo=UTC)


def person(uid="u1", **patch):
    return {
        "id": uid,
        "display_name": uid,
        "revision": 1,
        "active": True,
        "archived_at": None,
        "valid_from": None,
        "valid_until": None,
        "assignments": {"front": {"enabled": True, "allowed_locks": [1], "sync_state": "pending"}},
        "pin": "827461",
        "phone": "0509007676",
        "photo": "private-image",
        **patch,
    }


async def decide(store, p, **patch):
    prior = store.preview(p, "front", 1)
    return await store.decide(
        lambda: p,
        "front",
        1,
        actor="actor",
        person_revision=prior["person_revision"],
        expected_fingerprint=prior["fingerprint"],
        latest_id=prior["latest_id"],
        decision=patch.pop("decision", "keep"),
        reason=patch.pop("reason", "Rights reviewed"),
        cadence_days=patch.pop("cadence_days", 30),
        confirmed=patch.pop("confirmed", True),
        **patch,
    )


async def test_receipt_roundtrip_preserves_person_and_scope_and_excludes_secrets():
    save, changed = AsyncMock(), Mock()
    store = PermissionReviews(save, changed, lambda: NOW)
    p = person()
    before = deepcopy(p)
    result = await decide(store, p)
    assert result["scope"] == "selected_door" and result["access_changed"] is False
    receipt = result["receipt"]
    assert (
        receipt["actor"] == "actor" and receipt["due_at"] == (NOW + timedelta(days=30)).isoformat()
    )
    assert p == before
    payload = str(save.await_args.args[0])
    assert all(secret not in payload for secret in ("827461", "0509007676", "private-image"))
    restored = PermissionReviews(AsyncMock(), Mock(), lambda: NOW)
    restored.load(save.await_args.args[0])
    assert restored.preview(p, "front", 1) == store.preview(p, "front", 1)
    result["receipt"]["reason"] = "tampered"
    assert store.history("u1", "front", 1)[0]["reason"] == "Rights reviewed"
    assert store.history("u1", "rear", 1) == [] and store.history("u1", "front", 2) == []
    changed.assert_called_once()


async def test_due_stale_followup_and_archive_states_have_explicit_boundaries():
    now = [NOW]
    store = PermissionReviews(AsyncMock(), Mock(), lambda: now[0])
    p = person()
    assert store.report([p], "front", 1)["records"][0]["status"] == "pending"
    await decide(store, p, cadence_days=1)
    now[0] += timedelta(days=1) - timedelta(seconds=1)
    assert store.report([p], "front", 1)["records"][0]["status"] == "completed"
    now[0] += timedelta(seconds=1)
    assert store.report([p], "front", 1)["records"][0]["status"] == "due"
    p["active"] = False
    assert store.report([p], "front", 1)["records"][0]["status"] == "stale"
    await decide(store, p, decision="followup")
    assert store.report([p], "front", 1)["records"][0]["status"] == "followup"
    p["archived_at"] = NOW.isoformat()
    archived = store.report([p], "front", 1)
    assert (
        archived["records"][0]["status"] == "archived" and len(store.history("u1", "front", 1)) == 2
    )


async def test_permission_semantics_stale_but_photos_credentials_and_other_doors_do_not():
    store = PermissionReviews(AsyncMock(), Mock(), lambda: NOW)
    p = person()
    await decide(store, p)
    p.update(revision=9, phone="other", pin="other", photo="other", display_name="Renamed")
    p["assignments"]["rear"] = {"enabled": True, "allowed_locks": [2]}
    p["group_ids"] = ["hidden_group"]
    assert store.report([p], "front", 1)["records"][0]["status"] == "completed"
    p["assignments"]["front"]["allowed_locks"] = [2]
    assert store.report([p], "front", 1)["records"][0]["status"] == "stale"
    p["access_timing_policy"] = {
        "mode": "ha",
        "schedule": {"days": ["Monday"]},
        "bindings": {"rear": "opaque"},
    }
    assert "opaque" not in str(store.preview(p, "front", 1))


async def test_paging_and_counters_only_use_caller_projected_people():
    store = PermissionReviews(AsyncMock(), Mock(), lambda: NOW)
    hidden = person("secret-person")
    await decide(store, hidden)
    shown = [person("a"), person("b"), person("outside", assignments={"rear": {"enabled": True}})]
    page = store.report(shown, "front", 1, limit=1)
    assert (
        page["total"] == 2 and page["summary"]["pending"] == 2 and page["summary"]["completed"] == 0
    )
    assert "secret-person" not in str(page) and "outside" not in str(page)
    next_page = store.report(shown, "front", 1, offset=1, limit=1, snapshot=page["snapshot"])
    assert next_page["records"][0]["user_id"] == "b"
    await decide(store, shown[0])
    stale = store.report(shown, "front", 1, offset=1, limit=1, snapshot=page["snapshot"])
    assert stale["stale"] and not stale["records"]
    assert store.report(shown, "front", 1, user_id="a")["total"] == 1
    assert store.report(shown, "front", 1, permission_context="new")["snapshot"] != page["snapshot"]


async def test_failed_save_does_not_publish_or_change_latest_receipt():
    save, changed = AsyncMock(), Mock()
    store = PermissionReviews(save, changed, lambda: NOW)
    p = person()
    await decide(store, p)
    first = store.history("u1", "front", 1)
    save.side_effect = OSError("disk failed")
    with pytest.raises(OSError):
        await decide(store, p, decision="followup")
    assert store.history("u1", "front", 1) == first
    changed.assert_called_once()


async def test_simultaneous_decisions_have_one_winner_and_changed_source_is_rejected():
    store = PermissionReviews(AsyncMock(), Mock(), lambda: NOW)
    p = person()
    preview = store.preview(p, "front", 1)
    args = dict(
        actor="actor",
        person_revision=1,
        expected_fingerprint=preview["fingerprint"],
        latest_id="",
        decision="keep",
        reason="Reviewed",
        cadence_days=30,
        confirmed=True,
    )
    results = await asyncio.gather(
        *(store.decide(lambda: p, "front", 1, **args) for _ in range(2)), return_exceptions=True
    )
    assert (
        sum(isinstance(row, AccessError) for row in results) == 1
        and len(store.history("u1", "front", 1)) == 1
    )
    p["revision"] += 1
    with pytest.raises(AccessError, match="access_review_stale"):
        await store.decide(lambda: p, "front", 1, **args)

    def revoked():
        raise AccessError("unauthorized")

    with pytest.raises(AccessError, match="unauthorized"):
        await store.decide(revoked, "front", 1, **args)


async def test_cancelled_save_finishes_once_and_keeps_lock_until_persisted():
    started, release = asyncio.Event(), asyncio.Event()
    saved = []

    async def save(data):
        started.set()
        await release.wait()
        saved.append(data)

    store = PermissionReviews(save, Mock(), lambda: NOW)
    p = person()
    task = asyncio.create_task(decide(store, p))
    await started.wait()
    task.cancel()
    await asyncio.sleep(0)
    task.cancel()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(saved) == 1 and len(store.history("u1", "front", 1)) == 1


@pytest.mark.parametrize(
    "patch",
    [
        {"decision": "revoke"},
        {"decision": []},
        {"reason": ""},
        {"reason": "x" * 501},
        {"reason": "bad\nreason"},
        {"cadence_days": True},
        {"cadence_days": 0},
        {"cadence_days": 366},
        {"confirmed": False},
    ],
)
async def test_invalid_decisions_are_not_writes(patch):
    save = AsyncMock()
    store = PermissionReviews(save, Mock())
    with pytest.raises(AccessError):
        await decide(store, person(), **patch)
    save.assert_not_awaited()


@pytest.mark.parametrize(
    "patch",
    [
        {"lock": True},
        {"lock": 3},
        {"state": "invalid"},
        {"limit": True},
        {"limit": 101},
        {"offset": -1},
        {"snapshot": "x" * 65},
    ],
)
def test_report_validation(patch):
    store = PermissionReviews(AsyncMock(), Mock())
    with pytest.raises(AccessError):
        store.report([person()], "front", patch.pop("lock", 1), **patch)


@pytest.mark.parametrize(
    "patch", [{"schema": True}, {"schema": 2}, {"receipts": {}}, {"extra": "secret"}]
)
def test_invalid_storage_not_silently_replaced(patch):
    store = PermissionReviews(AsyncMock(), Mock())
    with pytest.raises(AccessError, match="invalid_storage"):
        store.load({"schema": 1, "receipts": [], **patch})


async def test_tampered_due_and_receipt_extra_data_are_rejected():
    save = AsyncMock()
    store = PermissionReviews(save, Mock(), lambda: NOW)
    await decide(store, person())
    data = deepcopy(save.await_args.args[0])
    data["receipts"][0]["due_at"] = NOW.isoformat()
    with pytest.raises(AccessError, match="invalid_storage"):
        store.load(data)
    data = deepcopy(save.await_args.args[0])
    data["receipts"][0]["pin"] = "not allowed"
    with pytest.raises(AccessError, match="invalid_storage"):
        store.load(data)
