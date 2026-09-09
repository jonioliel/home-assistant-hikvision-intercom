"""Fault injection at write/read/persistence boundaries, using no network transport."""

import asyncio
import json
from copy import deepcopy
from unittest.mock import AsyncMock

import pytest
from test_schedule_journal import inputs

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.schedule_executor import (
    ScheduleExecutor,
    ScheduleObservation,
)
from custom_components.hikvision_intercom.access.schedule_journal import ScheduleJournal


class Transport:
    writes_verified = True  # Synthetic contract only; never device capability evidence.

    def __init__(self, data):
        self.records = deepcopy(data["observed"])
        self.context = deepcopy(data["context"])
        self.eligible = True
        self.writes = []
        self.reads = 0
        self.before_read = None
        self.before_write = None

    async def observe(self, transaction):
        self.reads += 1
        if self.before_read:
            await self.before_read(self, transaction)
        return ScheduleObservation(deepcopy(self.context), deepcopy(self.records), self.eligible)

    async def write(self, resource):
        self.writes.append(resource["key"])
        if self.before_write:
            await self.before_write(self, resource)
        self.records[resource["key"]] = deepcopy(resource["body"])


async def setup(*, holidays=False, save=None):
    data = inputs(holidays)
    save = save or AsyncMock()
    store = ScheduleJournal(save)
    item = await store.async_prepare(**data)
    transport = Transport(data)
    return store, item["id"], transport, save


async def test_complete_dependency_order_and_intent_is_durable_before_each_write():
    store, identifier, transport, save = await setup(holidays=True)

    async def check(t, resource):
        durable = save.call_args.args[0]["transactions"][identifier]
        active = next(s for s in durable["steps"] if s["state"] == "intent")
        assert active["key"] == resource["key"] and active["attempted"]

    transport.before_write = check
    result = await ScheduleExecutor(store, transport).execute(identifier)
    assert result["status"] == "verified"
    assert transport.writes == ["weekly:20", "holiday:30", "holiday_group:3", "template:10"]
    restored = ScheduleJournal(AsyncMock())
    await restored.async_load(save.call_args.args[0])
    assert restored.public(identifier) == result
    await ScheduleExecutor(restored, transport).execute(identifier)
    assert len(transport.writes) == 4


async def test_unverified_transport_does_not_read_or_write_and_recovery_remains_read_only():
    store, identifier, t, _ = await setup()
    t.writes_verified = False
    executor = ScheduleExecutor(store, t)
    with pytest.raises(AccessError, match="schedule_writes_unverified"):
        await executor.execute(identifier)
    assert not t.reads and not t.writes
    assert (await executor.recover(identifier))["status"] == "ready"
    assert t.reads == 1 and not t.writes


@pytest.mark.parametrize("applied", [False, True])
async def test_lost_ack_is_resolved_by_readback_without_resending(applied):
    store, identifier, t, save = await setup()

    async def fail(t, resource):
        if applied:
            t.records[resource["key"]] = deepcopy(resource["body"])
        raise TimeoutError("PRIVATE response with credentials")

    t.before_write = fail
    result = await ScheduleExecutor(store, t).execute(identifier)
    assert result["status"] == ("ready" if applied else "recovery_required")
    assert t.writes == ["weekly:20"]
    assert "PRIVATE" not in json.dumps(result)
    restored = ScheduleJournal(AsyncMock())
    await restored.async_load(save.call_args.args[0])
    executor = ScheduleExecutor(restored, t)
    for _ in range(3):
        await executor.recover(identifier)
    assert t.writes == ["weekly:20"]
    t.before_write = None
    await executor.execute(identifier)
    assert t.writes == (["weekly:20", "template:10"] if applied else ["weekly:20"])


@pytest.mark.parametrize("applied", [False, True])
async def test_process_cancellation_keeps_intent_and_restart_only_reads(applied):
    store, identifier, t, save = await setup()

    async def cancel(t, resource):
        if applied:
            t.records[resource["key"]] = deepcopy(resource["body"])
        raise asyncio.CancelledError

    t.before_write = cancel
    with pytest.raises(asyncio.CancelledError):
        await ScheduleExecutor(store, t).execute(identifier)
    assert not store._running and store.get(identifier)["status"] == "recovery_required"
    restored = ScheduleJournal(AsyncMock())
    await restored.async_load(save.call_args.args[0])
    result = await ScheduleExecutor(restored, t).execute(identifier)
    assert result["status"] == ("ready" if applied else "recovery_required")
    assert t.writes == ["weekly:20"]


@pytest.mark.parametrize(
    "context_key", ["identity", "capability", "dependencies", "ownership", "source", "eligible"]
)
async def test_changed_context_blocks_before_any_write(context_key):
    store, identifier, t, _ = await setup()
    if context_key == "eligible":
        t.eligible = False
    else:
        t.context[context_key] = "c" * 64
    result = await ScheduleExecutor(store, t).execute(identifier)
    assert result["status"] == "conflict" and result["issue"] == "context_changed"
    assert not t.writes


@pytest.mark.parametrize("when", [1, 2, 4])
async def test_external_changes_before_intent_after_intent_or_to_completed_step_stop_progress(when):
    store, identifier, t, _ = await setup()

    async def mutate(t, transaction):
        if t.reads == when:
            t.records["weekly:20"]["UserRightWeekPlanCfg"]["PRIVATE_FIELD"] = "private"

    t.before_read = mutate
    result = await ScheduleExecutor(store, t).execute(identifier)
    assert result["issue"] == "read_failed"  # Unsupported fields cannot be normalized away.
    assert t.writes == (["weekly:20"] if when == 4 else [])
    assert "private" not in json.dumps(result).lower()


async def test_valid_external_change_is_terminal_conflict_and_never_rolled_back():
    store, identifier, t, _ = await setup()

    async def change(t, transaction):
        if t.reads == 4:
            t.records["weekly:20"]["UserRightWeekPlanCfg"]["WeekPlanCfg"][0]["TimeSegment"][
                "beginTime"
            ] = "10:00:00"

    t.before_read = change
    result = await ScheduleExecutor(store, t).execute(identifier)
    assert result["status"] == "conflict" and result["issue"] == "resource_changed"
    assert t.writes == ["weekly:20"]
    await ScheduleExecutor(store, t).recover(identifier)
    assert t.writes == ["weekly:20"]


@pytest.mark.parametrize("failure_read", [1, 2, 3])
async def test_offline_read_at_each_boundary_keeps_intent_without_replay(failure_read):
    store, identifier, t, save = await setup()

    async def fail(t, transaction):
        if t.reads == failure_read:
            raise OSError("PRIVATE network details")

    t.before_read = fail
    result = await ScheduleExecutor(store, t).execute(identifier)
    assert result["issue"] == "read_failed"
    assert t.writes == (["weekly:20"] if failure_read == 3 else [])
    assert result["status"] == ("ready" if failure_read == 1 else "recovery_required")
    t.before_read = None
    restored = ScheduleJournal(AsyncMock())
    await restored.async_load(save.call_args.args[0])
    await ScheduleExecutor(restored, t).recover(identifier)
    assert len(t.writes) <= 1


async def test_failed_intent_persistence_prevents_network_write():
    store, identifier, t, save = await setup()
    save.side_effect = AccessError("storage_write_failed")
    with pytest.raises(AccessError, match="storage_write_failed"):
        await ScheduleExecutor(store, t).execute(identifier)
    assert not t.writes and not store._running
    assert store.get(identifier)["steps"][0]["state"] == "pending"


async def test_failed_readback_persistence_does_not_rewrite_after_restart():
    store, identifier, t, save = await setup()

    async def fail_save(t, resource):
        save.side_effect = AccessError("storage_write_failed")

    t.before_write = fail_save
    with pytest.raises(AccessError, match="storage_write_failed"):
        await ScheduleExecutor(store, t).execute(identifier)
    assert t.writes == ["weekly:20"]
    restored = ScheduleJournal(AsyncMock())
    # Failed save arguments are not durable; the second call is the saved intent.
    await restored.async_load(save.call_args_list[1].args[0])
    await ScheduleExecutor(restored, t).execute(identifier)
    assert t.writes == ["weekly:20"]


async def test_noop_resources_are_verified_without_writes():
    store, identifier, t, _ = await setup()
    data = inputs()
    for body in data["observed"].values():
        next(iter(body.values()))["enable"] = True
    store = ScheduleJournal(AsyncMock())
    item = await store.async_prepare(**data)
    t = Transport(data)
    result = await ScheduleExecutor(store, t).execute(item["id"])
    assert result["status"] == "verified" and not t.writes
    assert all(not row["attempted"] for row in result["steps"])


async def test_two_executors_cannot_write_the_same_station_concurrently():
    store, identifier, t, _ = await setup()
    entered, release = asyncio.Event(), asyncio.Event()

    async def hold(t, transaction):
        entered.set()
        await release.wait()

    t.before_read = hold
    task = asyncio.create_task(ScheduleExecutor(store, t).execute(identifier))
    await entered.wait()
    with pytest.raises(AccessError, match="schedule_deployment_busy"):
        await ScheduleExecutor(store, t).execute(identifier)
    release.set()
    assert (await task)["status"] == "verified" and len(t.writes) == 2


async def test_io_deadline_leaves_ambiguous_write_for_read_only_recovery():
    store, identifier, t, _ = await setup()

    async def hang(t, resource):
        await asyncio.Event().wait()

    t.before_write = hang
    result = await ScheduleExecutor(store, t, timeout=0.01).execute(identifier)
    assert result["status"] == "recovery_required" and t.writes == ["weekly:20"]


async def test_acknowledgement_without_configuration_change_never_counts_as_verified():
    store, identifier, t, _ = await setup()

    async def accepted(resource):
        t.writes.append(resource["key"])

    t.write = accepted
    executor = ScheduleExecutor(store, t)
    result = await executor.execute(identifier)
    assert result["status"] == "recovery_required" and result["issue"] == "write_uncertain"
    await executor.execute(identifier)
    assert t.writes == ["weekly:20"]


async def test_transport_gate_revoked_during_intent_save_prevents_write():
    store, identifier, t, _ = await setup()

    async def revoke(t, transaction):
        if t.reads == 2:
            t.writes_verified = False

    t.before_read = revoke
    result = await ScheduleExecutor(store, t).execute(identifier)
    assert result["status"] == "conflict" and not t.writes


async def test_nine_synthetic_stations_keep_independent_execution_and_restart_history():
    disk = AsyncMock()
    store = ScheduleJournal(disk)
    jobs, transports = [], []
    for index in range(9):
        data = {**inputs(), "station": f"station-{index}"}
        item = await store.async_prepare(**data)
        transport = Transport(data)
        transports.append(transport)
        jobs.append(ScheduleExecutor(store, transport).execute(item["id"]))
    result = await asyncio.gather(*jobs)
    assert all(r["status"] == "verified" for r in result)
    assert all(t.writes == ["weekly:20", "template:10"] for t in transports)
    data = {**inputs(), "station": "station-0"}
    item = await store.async_prepare(**data)
    restored = ScheduleJournal(AsyncMock())
    await restored.async_load(disk.call_args.args[0])
    assert restored.public(item["id"])["status"] == "ready"


async def test_storage_failure_does_not_chain_private_adapter_exception():
    store, identifier, t, disk = await setup()

    async def fail(t, transaction):
        raise RuntimeError("PRIVATE_DEVICE_PAYLOAD")

    t.before_read = fail
    disk.side_effect = AccessError("storage_write_failed")
    with pytest.raises(AccessError) as caught:
        await ScheduleExecutor(store, t).execute(identifier)
    assert caught.value.__context__ is None
