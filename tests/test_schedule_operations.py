"""Atomic operations storage and bounded station queue contracts."""

import asyncio
import json
from copy import deepcopy
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from test_schedule_journal import inputs

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.schedule_operations import ScheduleOperations
from custom_components.hikvision_intercom.access.schedule_work_queue import ScheduleWorkQueue


def plan(station="station"):
    args = inputs()
    return {
        "id": str(uuid4()),
        "revision": 1,
        "station_id": station,
        "identity": "e" * 64,
        "draft": args["draft"],
        "bindings": args["bindings"],
        "capabilities": args["capabilities"],
    }


def inspection():
    return {
        "observed": inputs()["observed"],
        "report": {"blockers": ["schedule_writes_unverified"]},
    }


async def claimed(store, proposal=None):
    proposal = proposal or plan()
    preview = store.preview_claim(proposal, inspection(), "admin")
    return proposal, await store.async_claim(preview["token"], "admin", proposal)


async def test_claim_privacy_reload_drift_and_active_job_release():
    save = AsyncMock()
    store = ScheduleOperations(save)
    proposal, claim = await claimed(store)
    assert store.ownership(proposal, inspection())[0] == "current"
    public = json.dumps(store.public())
    assert all(key not in public for key in ["identity", "members", "e" * 64, "observed"])
    changed = inspection()
    next(iter(changed["observed"].values()))["UserRightWeekPlanCfg"]["enable"] = True
    assert store.ownership(proposal, changed)[0] == "changed"
    other = ScheduleOperations(AsyncMock())
    await other.async_load(save.call_args.args[0])
    assert other.ownership(proposal, inspection()) == store.ownership(proposal, inspection())
    job = await store.async_create(proposal)
    with pytest.raises(AccessError, match="schedule_claim_in_use"):
        await store.async_release(claim["id"], 1)
    cancelled = await store.async_update(job["id"], 1, status="cancelled")
    await store.async_archive(job["id"], cancelled["revision"])
    await store.async_release(claim["id"], 1)
    assert not store.public()["claims"] and not store.public()["jobs"]
    assert len(store.public()["archive"]) == 1


async def test_claim_tokens_are_actor_bound_expire_and_reject_stale_revision():
    clock = [0.0]
    store = ScheduleOperations(AsyncMock(), now=lambda: clock[0])
    proposal = plan()
    preview = store.preview_claim(proposal, inspection(), "admin")
    with pytest.raises(AccessError, match="schedule_claim_expired"):
        await store.async_claim(preview["token"], "other", proposal)
    with pytest.raises(AccessError, match="revision_conflict"):
        await store.async_claim(preview["token"], "admin", {**proposal, "revision": 2})
    clock[0] = 300
    with pytest.raises(AccessError, match="schedule_claim_expired"):
        await store.async_claim(preview["token"], "admin", proposal)
    assert not store.public()["claims"]


async def test_concurrent_claim_previews_cannot_overlap_but_other_station_can():
    store = ScheduleOperations(AsyncMock())
    first, second = plan(), plan()
    a = store.preview_claim(first, inspection(), "a")
    b = store.preview_claim(second, inspection(), "b")
    await store.async_claim(a["token"], "a", first)
    with pytest.raises(AccessError, match="schedule_claim_conflict"):
        await store.async_claim(b["token"], "b", second)
    await claimed(store, plan("other"))
    assert len(store.public()["claims"]) == 2


async def test_atomic_save_failure_and_cancelled_save_publish_only_committed_state():
    save = AsyncMock(side_effect=AccessError("storage_write_failed"))
    store = ScheduleOperations(save)
    proposal = plan()
    with pytest.raises(AccessError):
        await store.async_create(proposal)
    assert store.public()["jobs"] == []
    entered, release = asyncio.Event(), asyncio.Event()

    async def slow(data):
        entered.set()
        await release.wait()

    save.side_effect = slow
    task = asyncio.create_task(store.async_create(proposal))
    await entered.wait()
    task.cancel()
    await asyncio.sleep(0)
    assert not task.done() and not store.public()["jobs"]
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(store.public()["jobs"]) == 1


@pytest.mark.parametrize("state", ["queued", "checking"])
async def test_reload_interrupts_jobs_durably_without_resuming(state):
    save = AsyncMock()
    store = ScheduleOperations(save)
    job = await store.async_create(plan())
    await store.async_update(job["id"], 1, status=state)
    other_save = AsyncMock()
    other = ScheduleOperations(other_save)
    await other.async_load(save.call_args.args[0])
    restored = other.job(job["id"])
    assert restored["status"] == "interrupted" and restored["revision"] == 3
    assert other_save.call_args.args[0]["jobs"][job["id"]] == restored
    failed = ScheduleOperations(AsyncMock(side_effect=AccessError("storage_write_failed")))
    with pytest.raises(AccessError, match="storage_write_failed"):
        await failed.async_load(save.call_args.args[0])
    assert not failed.public()["jobs"]


@pytest.mark.parametrize("damage", ["extra", "duplicate", "resource", "archive", "status"])
async def test_corrupt_store_is_rejected_without_overwrite(damage):
    save = AsyncMock()
    store = ScheduleOperations(save)
    job = await store.async_create(plan())
    data = deepcopy(save.call_args.args[0])
    if damage == "extra":
        data["unexpected"] = True
    if damage == "duplicate":
        data["archive"].append(data["jobs"][job["id"]])
    if damage == "resource":
        data["jobs"][job["id"]]["resource_keys"] = ["weekly:01"]
    if damage == "archive":
        data["archive"] = list(data["jobs"].values())
        data["jobs"] = {}
    if damage == "status":
        data["jobs"][job["id"]]["status"] = ["queued"]
    sink = AsyncMock()
    with pytest.raises(AccessError, match="invalid_storage"):
        await ScheduleOperations(sink).async_load(data)
    sink.assert_not_called()


async def test_job_uniqueness_revision_and_archive_retention():
    store = ScheduleOperations(AsyncMock())
    proposal = plan()
    first = await store.async_create(proposal)
    with pytest.raises(AccessError, match="schedule_operation_exists"):
        await store.async_create(proposal)
    with pytest.raises(AccessError, match="schedule_operation_retained"):
        await store.async_archive(first["id"], 1)
    with pytest.raises(AccessError, match="revision_conflict"):
        await store.async_update(first["id"], 9, status="cancelled")
    for i in range(130):
        item = first if i == 0 else await store.async_create(proposal)
        done = await store.async_update(item["id"], 1, status="cancelled")
        await store.async_archive(item["id"], done["revision"])
    assert len(store.public()["archive"]) == 128
    assert first["id"] not in {j["id"] for j in store.public()["archive"]}


async def test_active_job_limit_is_freed_only_after_terminal_archive():
    store = ScheduleOperations(AsyncMock())
    jobs = [await store.async_create(plan()) for _ in range(32)]
    with pytest.raises(AccessError, match="schedule_operation_limit"):
        await store.async_create(plan())
    done = await store.async_update(jobs[0]["id"], 1, status="cancelled")
    await store.async_archive(done["id"], done["revision"])
    await store.async_create(plan())
    assert len(store.public()["jobs"]) == 32


async def test_queue_per_station_and_fleet_limit_close_requires_explicit_restart():
    store = ScheduleOperations(AsyncMock())
    jobs = [await store.async_create(plan(str(i))) for i in range(4)]
    overlap = await store.async_create(plan("0"))
    entered = []
    gate = asyncio.Event()

    async def check(job):
        entered.append(job["station_id"])
        await gate.wait()
        return {"status": "blocked"}

    queue = ScheduleWorkQueue(store, check, Mock(), asyncio.create_task)
    for job in jobs:
        await queue.request(job["id"], 1)
    for _ in range(20):
        await asyncio.sleep(0)
    assert len(entered) == 3
    with pytest.raises(AccessError, match="schedule_read_busy"):
        await queue.request(overlap["id"], 1)
    with pytest.raises(AccessError, match="schedule_operation_retained"):
        await queue.cancel(overlap["id"], 1, AsyncMock())
    await queue.close()
    assert not queue._tasks
    assert {store.job(j["id"])["status"] for j in jobs} <= {"queued", "checking"}
    with pytest.raises(AccessError, match="station_unloaded"):
        await queue.request(overlap["id"], 1)


@pytest.mark.parametrize("error", [ValueError("PRIVATE_ERROR"), AccessError("connection_failed")])
async def test_queue_sanitizes_failures_and_other_station_progresses(error):
    store = ScheduleOperations(AsyncMock())
    a, b = await store.async_create(plan("a")), await store.async_create(plan("b"))

    async def check(job):
        if job["station_id"] == "a":
            raise error
        return {"status": "blocked"}

    queue = ScheduleWorkQueue(store, check, Mock(), asyncio.create_task)
    await queue.request(a["id"], 1)
    await queue.request(b["id"], 1)
    await asyncio.gather(*queue._tasks.values())
    assert store.job(a["id"])["status"] == "failed"
    assert store.job(b["id"])["status"] == "blocked"
    assert "PRIVATE_ERROR" not in json.dumps(store.public())
    await queue.close()


async def test_task_factory_failure_leaves_retryable_job_and_cleanup_is_atomic():
    store = ScheduleOperations(AsyncMock())
    job = await store.async_create(plan())
    queue = ScheduleWorkQueue(store, AsyncMock(), Mock(), Mock(side_effect=RuntimeError("PRIVATE")))
    with pytest.raises(AccessError, match="schedule_operation_failed"):
        await queue.request(job["id"], 1)
    current = store.job(job["id"])
    assert current["status"] == "failed" and not queue._tasks
    with pytest.raises(AccessError):
        await queue.cancel(
            job["id"],
            current["revision"],
            AsyncMock(side_effect=AccessError("storage_write_failed")),
        )
    assert store.job(job["id"]) == current
    cancelled = await queue.cancel(job["id"], current["revision"], AsyncMock())
    assert cancelled["status"] == "cancelled"
