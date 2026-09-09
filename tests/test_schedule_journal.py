"""Persistence, bounded transitions and retention of ambiguous schedule writes."""

import asyncio
import json
from copy import deepcopy
from unittest.mock import AsyncMock

import pytest
from test_schedule_compiler import capabilities, slots
from test_schedules import draft, holiday

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.schedule_compiler import compile_schedule
from custom_components.hikvision_intercom.access.schedule_journal import CONTEXT, ScheduleJournal


def inputs(with_holidays=False):
    data = draft()
    if with_holidays:
        data["holidays"] = [holiday()]
    binding = slots(int(with_holidays))
    resources = compile_schedule(data, binding, capabilities())
    observed = {r["key"]: deepcopy(r["body"]) for r in resources}
    for value in observed.values():
        next(iter(value.values()))["enable"] = False
    return dict(
        station="station",
        draft=data,
        bindings=binding,
        capabilities=capabilities(),
        context={key: "b" * 64 for key in CONTEXT},
        observed=observed,
        owned=set(observed),
    )


async def prepared(save=None, **changes):
    store = ScheduleJournal(save or AsyncMock())
    item = await store.async_prepare(**{**inputs(), **changes})
    return store, item["id"]


async def test_intent_survives_reload_and_public_report_excludes_private_payloads():
    save = AsyncMock()
    store, identifier = await prepared(save)
    await store.async_record(identifier, 1, index=0, step_state="intent")
    other = ScheduleJournal(AsyncMock())
    await other.async_load(save.call_args.args[0])
    assert other.get(identifier) == store.get(identifier)
    report = other.public(identifier)
    assert report["status"] == "recovery_required"
    assert report["steps"][0]["attempted"]
    assert not {"draft", "context", "capabilities", "station_id", "bindings"} & report.keys()
    assert "b" * 64 not in json.dumps(report)


async def test_requires_explicit_owned_observed_resources_and_blocks_station_overlap():
    store, identifier = await prepared()
    with pytest.raises(AccessError, match="schedule_deployment_busy"):
        await store.async_prepare(**inputs())
    for changes in (
        {"owned": set()},
        {"observed": {}},
        {"observed": {**inputs()["observed"], "weekly:99": {}}},
    ):
        with pytest.raises(AccessError, match="schedule_deployment_ownership_required"):
            await store.async_prepare(**{**inputs(), **changes})
    assert (await store.async_prepare(**{**inputs(), "station": "other"}))["status"] == "ready"
    await store.async_discard_unstarted(identifier, 1)
    assert (await store.async_prepare(**inputs()))["status"] == "ready"


async def test_ambiguous_and_partially_written_transactions_are_not_discarded_or_replayed():
    store, identifier = await prepared()
    await store.async_record(identifier, 1, index=0, step_state="intent")
    with pytest.raises(AccessError, match="schedule_deployment_invalid"):
        await store.async_record(identifier, 2, index=0, step_state="intent")
    with pytest.raises(AccessError, match="schedule_deployment_invalid"):
        await store.async_record(identifier, 2, index=1, step_state="intent")
    with pytest.raises(AccessError, match="schedule_deployment_retained"):
        await store.async_discard_unstarted(identifier, 2)
    await store.async_record(identifier, 2, index=0, step_state="verified")
    with pytest.raises(AccessError, match="schedule_deployment_retained"):
        await store.async_discard_unstarted(identifier, 3)


async def test_failed_save_preserves_previous_state_and_cancellation_waits_for_atomic_save():
    save = AsyncMock()
    store, identifier = await prepared(save)
    save.side_effect = AccessError("storage_write_failed")
    with pytest.raises(AccessError):
        await store.async_record(identifier, 1, index=0, step_state="intent")
    assert store.get(identifier)["steps"][0]["state"] == "pending"
    entered, release = asyncio.Event(), asyncio.Event()

    async def slow(data):
        entered.set()
        await release.wait()

    save.side_effect = slow
    task = asyncio.create_task(store.async_record(identifier, 1, index=0, step_state="intent"))
    await entered.wait()
    task.cancel()
    await asyncio.sleep(0)
    assert not task.done()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert store.get(identifier)["status"] == "recovery_required"


@pytest.mark.parametrize(
    "case",
    ["key", "extra", "hash", "order", "attempt", "status", "context", "name", "bool_revision"],
)
async def test_corrupt_journal_is_rejected_without_replacing_valid_state(case):
    save = AsyncMock()
    store, identifier = await prepared(save)
    original = store.get(identifier)
    data = deepcopy(save.call_args.args[0])
    item = data["transactions"][identifier]
    if case == "key":
        data["key"] = "c" * 64
    if case == "extra":
        item["PRIVATE"] = "PRIVATE"
    if case == "hash":
        item["steps"][0]["after"] = "f" * 64
    if case == "order":
        item["steps"][1].update(state="intent", attempted=True)
    if case == "attempt":
        item["steps"][0]["attempted"] = True
    if case == "status":
        item["status"] = "verified"
    if case == "context":
        item["context"]["identity"] = "PRIVATE"
    if case == "name":
        item["draft"]["name"] = "changed"
    if case == "bool_revision":
        item["revision"] = True
    with pytest.raises(AccessError, match="invalid_storage"):
        await store.async_load(data)
    assert store.get(identifier) == original


async def test_station_execution_lock_is_shared_by_all_executors():
    store, identifier = await prepared()
    async with store.execution(identifier):
        with pytest.raises(AccessError, match="schedule_deployment_busy"):
            async with store.execution(identifier):
                pytest.fail("concurrent execution")
        with pytest.raises(AccessError, match="schedule_deployment_retained"):
            await store.async_discard_unstarted(identifier, 1)
    async with store.execution(identifier):
        pass


async def test_revision_checks_noop_confirmation_and_terminal_conflict():
    store, identifier = await prepared()
    with pytest.raises(AccessError, match="revision_conflict"):
        await store.async_record(identifier, True, issue="read_failed")
    with pytest.raises(AccessError, match="schedule_deployment_invalid"):
        await store.async_record(identifier, 1, index=0, step_state="verified")
    await store.async_record(identifier, 1, issue="context_changed")
    with pytest.raises(AccessError, match="schedule_deployment_terminal"):
        await store.async_record(identifier, 2)
