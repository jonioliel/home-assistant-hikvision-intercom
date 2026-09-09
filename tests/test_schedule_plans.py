"""Proposal durability, stale approvals, collision isolation and secret-free projections."""

import asyncio
import json
from copy import deepcopy
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from test_schedule_compiler import capabilities, slots
from test_schedules import draft

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.schedule_compiler import compile_schedule
from custom_components.hikvision_intercom.access.schedule_plans import SchedulePlans

SOURCE = str(uuid4())


def inspection():
    candidates = compile_schedule(draft(), slots(), capabilities())
    return {
        "capability_fingerprint": "e" * 64,
        "capabilities": capabilities(),
        "fingerprints": {r["key"]: "a" * 64 for r in candidates},
        "candidates": candidates,
        "report": {
            "checked_at": "2026-09-09T00:00:00+00:00",
            "can_apply": False,
            "blockers": ["schedule_writes_unverified", "schedule_ownership_unknown"],
            "resources": [
                {
                    "kind": r["kind"],
                    "id": r["id"],
                    "coverage": "complete",
                    "state": "different",
                    "fields": ["enable"],
                    "active": False,
                    "externally_referenced": False,
                }
                for r in candidates
            ],
            "users": {
                "state": "complete",
                "error": None,
                "read": 0,
                "explicit": 0,
                "implicit": 0,
                "malformed": 0,
            },
        },
    }


def preview(store, actor="a", station="station"):
    return store.preview(station, "b" * 64, SOURCE, 1, draft(), slots(), inspection(), actor)


async def test_durable_roundtrip_and_export_does_not_expose_fingerprints_or_identity():
    save = AsyncMock()
    store = SchedulePlans(save)
    proposal = preview(store)
    assert not store.all() and save.await_count == 0
    saved = await store.async_save(proposal["token"], "a", "b" * 64, 1)
    restored = SchedulePlans(AsyncMock())
    await restored.async_load(save.call_args.args[0])
    assert restored.all() == [saved]
    exported = restored.public(restored.get(saved["id"]), details=True)
    assert "candidates" in exported and not exported["can_apply"]
    encoded = json.dumps(exported)
    assert "fingerprint" not in encoded and "identity" not in encoded and "b" * 64 not in encoded
    with pytest.raises(AccessError, match="schedule_plan_expired"):
        await store.async_save(proposal["token"], "a", "b" * 64, 1)


async def test_local_reservations_reject_overlap_but_other_station_is_independent():
    store = SchedulePlans(AsyncMock())
    a, b = preview(store), preview(store, actor="b")
    await store.async_save(a["token"], "a", "b" * 64, 1)
    with pytest.raises(AccessError, match="schedule_plan_resource_reserved"):
        await store.async_save(b["token"], "b", "b" * 64, 1)
    c = preview(store, station="other")
    await store.async_save(c["token"], "a", "b" * 64, 1)
    assert len(store.all()) == 2


async def test_approval_actor_identity_revision_and_expiry_are_checked():
    now = [0.0]
    store = SchedulePlans(AsyncMock(), now=lambda: now[0])
    p = preview(store)
    for actor, identity, revision, code in [
        ("b", "b" * 64, 1, "schedule_plan_expired"),
        ("a", "c" * 64, 1, "schedule_plan_device_changed"),
        ("a", "b" * 64, 2, "revision_conflict"),
    ]:
        with pytest.raises(AccessError, match=code):
            await store.async_save(p["token"], actor, identity, revision)
    now[0] = 301
    with pytest.raises(AccessError, match="schedule_plan_expired"):
        await store.async_save(p["token"], "a", "b" * 64, 1)
    assert store.all() == []


async def test_recheck_keeps_initial_fingerprint_and_tracks_capability_drift():
    store = SchedulePlans(AsyncMock())
    p = preview(store)
    saved = await store.async_save(p["token"], "a", "b" * 64, 1)
    changed = inspection()
    changed["fingerprints"]["weekly:20"] = "d" * 64
    changed["capabilities"]["weekly"]["precision"] = "second"
    result = await store.async_recheck(saved["id"], 1, "b" * 64, changed)
    assert result["drifted_resources"] == ["weekly:20"] and result["revision"] == 2
    assert "schedule_plan_capabilities_changed" in result["report"]["blockers"]
    result = await store.async_recheck(saved["id"], 2, "b" * 64, changed)
    assert result["drifted_resources"] == ["weekly:20"]
    assert store.get(saved["id"])["fingerprints"]["weekly:20"] == "a" * 64
    with pytest.raises(AccessError, match="revision_conflict"):
        await store.async_delete(saved["id"], 1)
    await store.async_delete(saved["id"], 3)
    assert store.all() == []


async def test_failed_persistence_and_cancelled_save_are_atomic():
    save = AsyncMock(side_effect=OSError())
    store = SchedulePlans(save)
    p = preview(store)
    with pytest.raises(OSError):
        await store.async_save(p["token"], "a", "b" * 64, 1)
    assert store.all() == []
    started, finish = asyncio.Event(), asyncio.Event()

    async def slow(state):
        started.set()
        await finish.wait()

    store = SchedulePlans(slow)
    p = preview(store)
    task = asyncio.create_task(store.async_save(p["token"], "a", "b" * 64, 1))
    await started.wait()
    task.cancel()
    finish.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(store.all()) == 1


@pytest.mark.parametrize(
    "case", ["schema", "hash", "report", "duplicate_slot", "extra", "candidate"]
)
async def test_corrupt_storage_rejected_without_replacing_loaded_state(case):
    save = AsyncMock()
    store = SchedulePlans(save)
    p = preview(store)
    await store.async_save(p["token"], "a", "b" * 64, 1)
    before = store.all()
    data = deepcopy(save.call_args.args[0])
    item = next(iter(data["plans"].values()))
    if case == "schema":
        data["schema"] = True
    if case == "hash":
        item["fingerprints"]["weekly:20"] = "PRIVATE_INVALID"
    if case == "report":
        item["report"]["can_apply"] = True
    if case == "duplicate_slot":
        other = deepcopy(item)
        other["id"] = str(uuid4())
        data["plans"][other["id"]] = other
    if case == "extra":
        item["report"]["users"]["password"] = "PRIVATE"
    if case == "candidate":
        item["bindings"]["weekly"] = 65535
    with pytest.raises(AccessError, match="invalid_storage"):
        await store.async_load(data)
    assert store.all() == before


async def test_raw_capability_change_is_detected_even_with_identical_normalized_limits():
    store = SchedulePlans(AsyncMock())
    proposed = preview(store)
    saved = await store.async_save(proposed["token"], "a", "b" * 64, 1)
    changed = inspection()
    changed["capability_fingerprint"] = "f" * 64
    result = await store.async_recheck(saved["id"], 1, "b" * 64, changed)
    assert "schedule_plan_capabilities_changed" in result["report"]["blockers"]
    assert not result["drifted_resources"]
    assert store.get(saved["id"])["capability_fingerprint"] == "e" * 64


async def test_proposal_and_pending_review_limits_are_bounded():
    store = SchedulePlans(AsyncMock())
    for i in range(20):
        preview(store, actor=str(i), station=str(i))
    assert len(store._pending) == 16
    for i in range(32):
        proposed = preview(store, station=str(i))
        await store.async_save(proposed["token"], "a", "b" * 64, 1)
    with pytest.raises(AccessError, match="schedule_plan_limit"):
        preview(store, station="another")
    assert len(store.all()) == 32
