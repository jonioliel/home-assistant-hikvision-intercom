"""The real native PUT adapter under a synthetic, explicit commissioning contract."""

from contextlib import asynccontextmanager
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from test_schedule_executor import Transport
from test_schedule_journal import inputs

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.schedule_compiler import compile_schedule
from custom_components.hikvision_intercom.access.schedule_executor import ScheduleExecutor
from custom_components.hikvision_intercom.access.schedule_journal import ScheduleJournal
from custom_components.hikvision_intercom.client.schedule_transport import (
    CommissioningScheduleTransport,
)


class Driver:
    def __init__(self, observer):
        self.client = SimpleNamespace(_expected_identity="test-station")
        self.observer = observer
        self.locked = False
        self.calls = []
        self.failure = None

    @asynccontextmanager
    async def transaction(self):
        assert not self.locked
        self.locked = True
        try:
            yield
        finally:
            self.locked = False

    def _require_mutation(self, kind, operation):
        assert self.locked and (kind, operation) == ("UserInfo", "put")

    async def _json(self, method, route, body):
        assert self.locked and method == "PUT"
        self.calls.append((method, route, deepcopy(body)))
        key = next(r["key"] for r in self.resources if r["body"] == body)
        if self.failure != "before":
            self.observer.records[key] = deepcopy(body)
        if self.failure:
            raise TimeoutError("PRIVATE raw response")
        return {"statusCode": 1}


async def setup(authorized=True):
    data = inputs(True)
    save = AsyncMock()
    journal = ScheduleJournal(save)
    item = await journal.async_prepare(**data)
    observer = Transport(data)
    driver = Driver(observer)
    driver.resources = compile_schedule(data["draft"], data["bindings"], data["capabilities"])
    adapter = CommissioningScheduleTransport(
        driver, journal, item["id"], observer.observe, authorized=authorized
    )
    return journal, item["id"], observer, driver, adapter, save


async def test_documented_routes_dependency_order_and_fresh_observation_under_lock():
    journal, identifier, observer, driver, adapter, _ = await setup()
    seen_lock = []

    async def checked(transaction):
        seen_lock.append(driver.locked)
        return await observer.observe(transaction)

    adapter._observer = checked
    result = await ScheduleExecutor(journal, adapter).execute(identifier)
    assert result["status"] == "verified"
    assert [call[1] for call in driver.calls] == [
        "/ISAPI/AccessControl/UserRightWeekPlanCfg/20?format=json",
        "/ISAPI/AccessControl/UserRightHolidayPlanCfg/30?format=json",
        "/ISAPI/AccessControl/UserRightHolidayGroupCfg/3?format=json",
        "/ISAPI/AccessControl/UserRightPlanTemplate/10?format=json",
    ]
    assert sum(seen_lock) == 4
    assert not driver.locked


async def test_disabled_by_default_and_no_io_when_not_authorized():
    journal, identifier, observer, driver, adapter, _ = await setup(False)
    with pytest.raises(AccessError, match="schedule_writes_unverified"):
        await ScheduleExecutor(journal, adapter).execute(identifier)
    assert not driver.calls and not observer.reads


@pytest.mark.parametrize("failure", ["before", "after"])
async def test_lost_ack_restart_does_not_replay_intent(failure):
    journal, identifier, observer, driver, adapter, save = await setup()
    driver.failure = failure
    result = await ScheduleExecutor(journal, adapter).execute(identifier)
    assert len(driver.calls) == 1
    assert result["status"] == ("recovery_required" if failure == "before" else "ready")
    restored = ScheduleJournal(AsyncMock())
    await restored.async_load(save.call_args.args[0])
    adapter = CommissioningScheduleTransport(
        driver, restored, identifier, observer.observe, authorized=True
    )
    if failure == "before":
        with pytest.raises(AccessError, match="schedule_write_uncertain"):
            await adapter.write(driver.resources[0])
    await ScheduleExecutor(restored, adapter).recover(identifier)
    assert len(driver.calls) == 1 and not driver.locked


async def test_no_direct_write_without_durable_intent_or_with_mutated_payload():
    journal, identifier, _, driver, adapter, _ = await setup()
    with pytest.raises(AccessError):
        await adapter.write(driver.resources[0])
    await journal.async_record(identifier, 1, index=0, step_state="intent")
    changed = deepcopy(driver.resources[0])
    changed["body"]["UserRightWeekPlanCfg"]["enable"] = False
    with pytest.raises(AccessError):
        await adapter.write(changed)
    assert not driver.calls


async def test_context_change_inside_write_lock_stops_put():
    journal, identifier, observer, driver, adapter, _ = await setup()

    async def changed(transaction):
        if driver.locked:
            observer.context["identity"] = "d" * 64
        return await observer.observe(transaction)

    adapter._observer = changed
    result = await ScheduleExecutor(journal, adapter).execute(identifier)
    assert result["status"] == "conflict"
    assert not driver.calls


async def test_identity_is_required_even_before_commissioning_adapter_can_be_created():
    journal, identifier, observer, driver, _, _ = await setup()
    driver.client._expected_identity = None
    with pytest.raises(AccessError, match="schedule_plan_device_changed"):
        CommissioningScheduleTransport(
            driver, journal, identifier, observer.observe, authorized=True
        )
