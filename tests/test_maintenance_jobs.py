"""Crash recovery, authority changes, windows and isolated station failures."""

import asyncio
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.maintenance_jobs import MaintenanceJobs, fingerprint

NOW = datetime.now(UTC)
WINDOW = {
    "enabled": False,
    "days": list(range(7)),
    "start": "08:00",
    "end": "18:00",
    "timezone": "UTC",
}
ROW = {
    "station_id": "station-1",
    "name": "Main gate",
    "door": 1,
    "identity_stamp": "a" * 64,
    "expected": {"doorName": "Gate", "openDuration": 5, "relayReverseEnabled": True},
    "changes": {"openDuration": 7, "relayReverseEnabled": False},
    "window": WINDOW,
}
DESIRED = {**ROW["expected"], **ROW["changes"]}


async def queued(*, rows=None, dual=False, save=None):
    jobs = MaintenanceJobs(save or AsyncMock())
    job = await jobs.enqueue("admin", rows or [ROW], dual, NOW)
    return jobs, job


async def test_window_wait_and_intent_precede_one_verified_write():
    closed = {
        **ROW,
        "window": {
            **WINDOW,
            "enabled": True,
            "days": [NOW.weekday()],
            "start": "00:00",
            "end": "00:01",
        },
    }
    jobs, job = await queued(rows=[closed])
    write = AsyncMock(return_value=DESIRED)
    await jobs.run(
        NOW.replace(hour=12),
        guard=AsyncMock(),
        read=AsyncMock(return_value=ROW["expected"]),
        write=write,
    )
    assert jobs.get(job["id"])["rows"][0]["state"] == "pending"
    write.assert_not_awaited()

    async def observed_write(row):
        assert jobs.get(job["id"])["rows"][0]["state"] == "writing"
        return DESIRED

    await jobs.run(
        NOW.replace(hour=0, minute=0),
        guard=AsyncMock(),
        read=AsyncMock(return_value=ROW["expected"]),
        write=observed_write,
    )
    assert jobs.get(job["id"])["state"] == "verified"
    await jobs.run(NOW, guard=AsyncMock(), read=AsyncMock(), write=write)
    write.assert_not_awaited()


async def test_lost_ack_and_restart_read_back_without_replaying_write():
    jobs, job = await queued()
    write = AsyncMock(side_effect=TimeoutError)
    await jobs.run(
        NOW, guard=AsyncMock(), read=AsyncMock(return_value=ROW["expected"]), write=write
    )
    assert jobs.get(job["id"])["rows"][0]["state"] == "writing"
    restored = MaintenanceJobs(AsyncMock())
    restored.load(deepcopy(jobs.data))
    await restored.run(NOW, guard=AsyncMock(), read=AsyncMock(return_value=DESIRED), write=write)
    assert restored.get(job["id"])["state"] == "verified"
    assert write.await_count == 1


async def test_uncertain_recovery_does_not_retry_and_other_station_progresses():
    second = {**ROW, "station_id": "station-2"}
    jobs, job = await queued(rows=[ROW, second])
    await jobs._row(job["id"], 0, "writing")
    write = AsyncMock(return_value=DESIRED)
    await jobs.run(
        NOW, guard=AsyncMock(), read=AsyncMock(return_value=ROW["expected"]), write=write
    )
    rows = jobs.get(job["id"])["rows"]
    assert [r["state"] for r in rows] == ["uncertain", "verified"]
    assert write.await_count == 1 and write.await_args.args[0]["station_id"] == "station-2"
    assert jobs.get(job["id"])["state"] == "completed_with_errors"


@pytest.mark.parametrize("code", ["unauthorized", "device_changed", "revision_conflict"])
async def test_guard_failure_and_parameter_drift_never_write(code):
    jobs, job = await queued()
    write = AsyncMock()
    await jobs.run(
        NOW, guard=AsyncMock(side_effect=AccessError(code)), read=AsyncMock(), write=write
    )
    write.assert_not_awaited()
    assert jobs.get(job["id"])["rows"][0]["state"] == "failed"
    jobs, job = await queued()
    await jobs.run(
        NOW,
        guard=AsyncMock(),
        read=AsyncMock(return_value={**ROW["expected"], "openDuration": 6}),
        write=write,
    )
    assert jobs.get(job["id"])["rows"][0]["code"] == "revision_conflict"
    write.assert_not_awaited()


async def test_dual_approval_exact_plan_and_later_policy_enable_wait():
    jobs, job = await queued(dual=True)
    write = AsyncMock(return_value=DESIRED)
    await jobs.run(NOW, guard=AsyncMock(), read=AsyncMock(), write=write)
    write.assert_not_awaited()
    for actor, digest in [("admin", fingerprint(job)), ("other", "wrong")]:
        with pytest.raises(AccessError):
            await jobs.decide(job["id"], digest, actor, True)
    await jobs.decide(job["id"], fingerprint(job), "other", True)
    await jobs.run(
        NOW, guard=AsyncMock(), read=AsyncMock(return_value=ROW["expected"]), write=write
    )
    assert jobs.get(job["id"])["state"] == "verified"
    jobs, job = await queued()
    await jobs.run(
        NOW,
        guard=AsyncMock(side_effect=AccessError("approval_required")),
        read=AsyncMock(),
        write=write,
    )
    assert jobs.get(job["id"])["state"] == "awaiting_approval"
    assert write.await_count == 1


async def test_failed_persistence_cannot_send_put_and_state_is_not_published():
    jobs, job = await queued()
    saved = deepcopy(jobs.data)
    jobs._save = AsyncMock(side_effect=OSError("disk unavailable"))
    write = AsyncMock()
    with pytest.raises(OSError):
        await jobs.run(
            NOW, guard=AsyncMock(), read=AsyncMock(return_value=ROW["expected"]), write=write
        )
    write.assert_not_awaited()
    assert jobs.data == saved


async def test_cancel_during_read_and_during_write_keep_verified_change():
    jobs, job = await queued()

    async def read_cancel(row):
        await jobs.cancel(job["id"], fingerprint(job))
        return ROW["expected"]

    write = AsyncMock()
    await jobs.run(NOW, guard=AsyncMock(), read=read_cancel, write=write)
    write.assert_not_awaited()
    assert jobs.get(job["id"])["state"] == "cancelled"
    jobs, job = await queued(rows=[ROW, {**ROW, "station_id": "station-2"}])

    async def write_cancel(row):
        await jobs.cancel(job["id"], fingerprint(job))
        return DESIRED

    await jobs.run(
        NOW, guard=AsyncMock(), read=AsyncMock(return_value=ROW["expected"]), write=write_cancel
    )
    assert [r["state"] for r in jobs.get(job["id"])["rows"]] == ["verified", "cancelled"]


async def test_expiry_cancels_pending_but_recovers_interrupted_write():
    jobs, job = await queued(rows=[ROW, {**ROW, "station_id": "station-2"}])
    await jobs._row(job["id"], 0, "writing")
    write = AsyncMock()
    await jobs.run(
        NOW + timedelta(days=9),
        guard=AsyncMock(),
        read=AsyncMock(return_value=DESIRED),
        write=write,
    )
    assert jobs.get(job["id"])["state"] == "expired"
    assert [r["state"] for r in jobs.get(job["id"])["rows"]] == ["verified", "cancelled"]
    write.assert_not_awaited()


async def test_concurrent_tick_never_duplicates_pending_write():
    jobs, job = await queued()
    entered, release = asyncio.Event(), asyncio.Event()

    async def read(row):
        entered.set()
        await release.wait()
        return ROW["expected"]

    write = AsyncMock(return_value=DESIRED)
    task = asyncio.create_task(jobs.run(NOW, guard=AsyncMock(), read=read, write=write))
    await entered.wait()
    await jobs.run(NOW, guard=AsyncMock(), read=AsyncMock(), write=write)
    release.set()
    await task
    assert jobs.get(job["id"])["state"] == "verified"
    assert write.await_count == 1


@pytest.mark.parametrize(
    "tamper", ["credential", "coerce_bool", "unknown_state", "bad_consent", "unknown_key"]
)
async def test_strict_restore_rejects_corrupt_or_unapproved_changes(tamper):
    jobs, job = await queued()
    data = deepcopy(jobs.data)
    item = data["jobs"][job["id"]]
    if tamper == "credential":
        item["rows"][0]["changes"]["pin"] = "SECRET"
    elif tamper == "coerce_bool":
        item["rows"][0]["changes"]["relayReverseEnabled"] = "false"
    elif tamper == "unknown_state":
        item["state"] = "running_forever"
    elif tamper == "bad_consent":
        item["consent"] = {"actor": "admin", "fingerprint": fingerprint(job), "approved": True}
    else:
        data["password"] = "SECRET"
    with pytest.raises(AccessError, match="storage_corrupt"):
        jobs.load(data)


async def test_resource_budget_limits_work_per_tick_without_fleet_size_assumption():
    rows = [{**ROW, "station_id": f"station-{index}"} for index in range(12)]
    jobs, job = await queued(rows=rows)
    write = AsyncMock(return_value=DESIRED)
    await jobs.run(
        NOW, guard=AsyncMock(), read=AsyncMock(return_value=ROW["expected"]), write=write, budget=3
    )
    assert write.await_count == 3
    assert sum(r["state"] == "pending" for r in jobs.get(job["id"])["rows"]) == 9


async def test_transient_unloaded_stations_wait_without_starving_other_jobs():
    jobs, first = await queued(rows=[{**ROW, "station_id": f"waiting-{i}"} for i in range(4)])
    second = await jobs.enqueue("admin", [ROW], False, NOW)

    async def guard(job, row, recovery):
        if row["station_id"].startswith("waiting-"):
            raise AccessError("station_unloaded")

    write = AsyncMock(return_value=DESIRED)
    await jobs.run(NOW, guard=guard, read=AsyncMock(return_value=ROW["expected"]), write=write)
    write.assert_not_awaited()
    await jobs.run(NOW, guard=guard, read=AsyncMock(return_value=ROW["expected"]), write=write)
    assert jobs.get(second["id"])["state"] == "verified"
    assert jobs.get(first["id"])["state"] == "queued"
    assert write.await_count == 1
