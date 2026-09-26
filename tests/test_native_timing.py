"""Production native activation: durable dependency order, readback and fail-closed guards."""

from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from test_schedule_compiler import capabilities, slots
from test_user_timing import weekly
from test_user_timing_plan import USER_CAP

from custom_components.smplwise_access_control.access import native_timing as module
from custom_components.smplwise_access_control.access.models import AccessError, build_user
from custom_components.smplwise_access_control.access.native_timing import NativeTiming
from custom_components.smplwise_access_control.access.schedule_compiler import (
    ROOTS,
    compile_schedule,
)
from custom_components.smplwise_access_control.access.schedule_journal import ScheduleJournal
from custom_components.smplwise_access_control.access.user_timing_plan import user_schedule


async def environment(monkeypatch):
    schedule = {**weekly(), "timezone": "UTC"}
    user = build_user(
        {
            "display_name": "Synthetic",
            "assignments": {"a": {"allowed_locks": [1]}},
            "access_timing_policy": {
                "mode": "native",
                "schedule": schedule,
                "bindings": {"a": slots()},
            },
        },
        employee_no="1001",
        now="2026-09-16T00:00:00+00:00",
    )
    candidates = compile_schedule(user_schedule(schedule), slots(), capabilities())
    records = {r["key"]: deepcopy(r["body"]) for r in candidates}
    for r in candidates:
        records[r["key"]][ROOTS[r["kind"]]]["enable"] = False
    blockers = []

    async def inspect(*args, **kwargs):
        return {
            "observed": deepcopy(records),
            "candidates": deepcopy(candidates),
            "capabilities": capabilities(),
            "capability_fingerprint": "a" * 64,
            "external_context": "b" * 64,
            "report": {
                "blockers": ["schedule_writes_unverified", "schedule_ownership_unknown", *blockers],
                "resources": [
                    {
                        "kind": r["kind"],
                        "coverage": "complete",
                        "active": records[r["key"]][ROOTS[r["kind"]]]["enable"],
                    }
                    for r in candidates
                ],
            },
        }

    monkeypatch.setattr(module, "inspect_plan", inspect)
    monkeypatch.setattr(
        module.ClockClient,
        "async_read",
        AsyncMock(
            return_value={
                "zone": {"kind": "iana", "name": "UTC"},
                "measurement": {
                    "status": "measured",
                    "estimated_skew_seconds": 0,
                    "uncertainty_seconds": 1,
                },
            }
        ),
    )
    calls = []
    failure = {"mode": None}

    async def request(method, route, body=None):
        if method == "GET":
            return {"UserInfo": {"RightPlan": USER_CAP}}
        calls.append((method, route, deepcopy(body)))
        resource = next(r for r in candidates if r["body"] == body)
        if failure["mode"] != "before":
            records[resource["key"]] = deepcopy(body)
        if failure["mode"]:
            raise TimeoutError("ack lost")
        return {"statusCode": 1}

    driver = SimpleNamespace(
        client=SimpleNamespace(_expected_identity="synthetic"),
        _require_mutation=lambda *a: None,
        _json=request,
        _verified_right_plans={},
    )
    save = AsyncMock()
    journal = ScheduleJournal(save)
    native = NativeTiming(journal)
    return user, driver, native, calls, records, blockers, failure, save


async def test_native_put_order_readback_assignment_and_repeat(monkeypatch):
    user, driver, native, calls, records, _, _, _ = await environment(monkeypatch)
    result = await native.ensure("a", user, driver, (1,))
    assert result == [{"doorNo": 1, "planTemplateNo": "10"}]
    assert result == driver._verified_right_plans[user.employee_no]
    assert [r[1] for r in calls] == [
        "/ISAPI/AccessControl/UserRightWeekPlanCfg/20?format=json",
        "/ISAPI/AccessControl/UserRightPlanTemplate/10?format=json",
    ]
    assert native.owns("a", user, result)
    assert not native.owns("b", user, result)
    assert await native.ensure("a", user, driver, (1,)) == result
    assert len(calls) == 2
    records["weekly:20"]["UserRightWeekPlanCfg"]["enable"] = False
    with pytest.raises(AccessError, match="schedule_resource_changed"):
        await native.ensure("a", user, driver, (1,))
    assert len(calls) == 2


@pytest.mark.parametrize(
    "blocker",
    [
        "schedule_plan_user_defaults",
        "schedule_plan_external_references",
        "schedule_plan_holiday_membership_unknown",
        "schedule_plan_observation_incomplete",
    ],
)
async def test_native_unknown_dependencies_do_not_write_or_authorize(monkeypatch, blocker):
    user, driver, native, calls, _, blockers, _, _ = await environment(monkeypatch)
    blockers.append(blocker)
    with pytest.raises(AccessError, match=blocker):
        await native.ensure("a", user, driver, (1,))
    assert not calls and not driver._verified_right_plans


@pytest.mark.parametrize("failure_mode", ["before", "after"])
async def test_native_lost_ack_restart_does_not_repeat_ambiguous_put(monkeypatch, failure_mode):
    user, driver, native, calls, _, _, failure, save = await environment(monkeypatch)
    failure["mode"] = failure_mode
    with pytest.raises(AccessError, match="schedule_deployment_incomplete"):
        await native.ensure("a", user, driver, (1,))
    assert len(calls) == 1 and not driver._verified_right_plans
    restored = ScheduleJournal(AsyncMock())
    await restored.async_load(save.call_args.args[0])
    native = NativeTiming(restored)
    failure["mode"] = None
    if failure_mode == "before":
        with pytest.raises(AccessError, match="schedule_deployment_incomplete"):
            await native.ensure("a", user, driver, (1,))
        assert len(calls) == 1
    else:
        await native.ensure("a", user, driver, (1,))
        assert len(calls) == 2


async def test_native_clock_mismatch_is_not_hidden_by_same_display_zone(monkeypatch):
    user, driver, native, calls, _, _, _, _ = await environment(monkeypatch)
    monkeypatch.setattr(
        module.ClockClient,
        "async_read",
        AsyncMock(
            return_value={
                "zone": {"kind": "iana", "name": "UTC"},
                "measurement": {
                    "status": "measured",
                    "estimated_skew_seconds": 20,
                    "uncertainty_seconds": 1,
                },
            }
        ),
    )
    with pytest.raises(AccessError, match="schedule_station_clock_unverified"):
        await native.ensure("a", user, driver, (1,))
    assert not calls


async def test_native_active_resources_are_not_adopted_by_selecting_ids(monkeypatch):
    user, driver, native, calls, records, _, _, _ = await environment(monkeypatch)
    records["weekly:20"]["UserRightWeekPlanCfg"]["enable"] = True
    with pytest.raises(AccessError, match="schedule_plan_active_resources"):
        await native.ensure("a", user, driver, (1,))
    assert not calls


async def test_allocator_excludes_external_references_and_respects_partial_coverage(monkeypatch):
    user, driver, native, _, _, _, _, _ = await environment(monkeypatch)
    incomplete = {"value": False}

    async def inventory(client, *, projected):
        projected.update(
            template=[
                {"id": 1, "enabled": False, "week": 1, "references": []},
                {"id": 2, "enabled": False, "week": 2, "references": []},
            ],
            weekly=[{"id": 1, "enabled": False}, {"id": 2, "enabled": False}],
        )
        return {
            "checks": [
                {"kind": "template", "state": "complete"},
                {"kind": "weekly", "state": "partial" if incomplete["value"] else "complete"},
            ]
        }

    async def dependencies(*args, references, **kwargs):
        references.add(1)
        return {"users_checked": True, "users": {"implicit": 0, "malformed": 0}}

    monkeypatch.setattr(module, "inspect_inventory", inventory)
    monkeypatch.setattr(module, "read_user_dependencies", dependencies)
    allocated = await native._allocate(
        "a", driver, user, user_schedule(user.access_timing_policy["schedule"])
    )
    assert allocated == {"template": 2, "weekly": 2, "holiday_group": None, "holidays": []}
    incomplete["value"] = True
    with pytest.raises(AccessError, match="schedule_inventory_incomplete"):
        await native._allocate(
            "a", driver, user, user_schedule(user.access_timing_policy["schedule"])
        )


async def test_dependency_context_changes_only_when_controlled_resources_gain_references(
    monkeypatch,
):
    from custom_components.smplwise_access_control.client import (
        schedule_plan_inspection as inspection,
    )

    draft = user_schedule({**weekly(), "timezone": "UTC"})
    candidates = compile_schedule(draft, slots(), capabilities())
    state = {"other": False, "shared": False}

    async def inventory(client, *, selected, records, projected, evidence, fingerprint):
        for resource in candidates:
            records.setdefault(resource["kind"], {})[str(resource["id"])] = resource["body"]
        projected.update(
            template=[{"id": 10, "week": 20, "references": []}],
            weekly=[],
            holiday_group=[],
            holiday=[],
        )
        if state["other"]:
            projected["template"].append(
                {"id": 99, "week": 20 if state["shared"] else 99, "references": []}
            )
        return {
            "complete": True,
            "checks": [
                {"kind": k, "state": "complete", "capabilities": v}
                for k, v in capabilities().items()
            ],
        }

    async def dependencies(*args, references, **kwargs):
        if state["other"]:
            references.add(99)
        return {
            "users_checked": True,
            "users": {"implicit": 0, "malformed": 0, "read": int(state["other"])},
        }

    monkeypatch.setattr(inspection, "inspect_inventory", inventory)
    monkeypatch.setattr(inspection, "read_user_dependencies", dependencies)
    digest = ScheduleJournal(AsyncMock()).fingerprint
    first = await inspection.inspect_plan(None, draft, slots(), digest)
    state["other"] = True
    second = await inspection.inspect_plan(None, draft, slots(), digest)
    assert first["external_context"] == second["external_context"]
    state["shared"] = True
    third = await inspection.inspect_plan(None, draft, slots(), digest)
    assert third["external_context"] != second["external_context"]
    assert "schedule_plan_external_references" in third["report"]["blockers"]
