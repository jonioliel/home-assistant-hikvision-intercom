"""Ordering, extra fields, missing rows and unknown defaults cannot imply readiness."""

import json
from copy import deepcopy
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from test_schedule_compiler import capabilities, slots
from test_schedule_inventory import SETTINGS, transport
from test_schedules import draft

from custom_components.hikvision_intercom.access.schedule_comparison import compare_resource
from custom_components.hikvision_intercom.access.schedule_compiler import compile_schedule
from custom_components.hikvision_intercom.client.client import HikvisionClient
from custom_components.hikvision_intercom.client.schedule_inventory import inspect_inventory
from custom_components.hikvision_intercom.client.schedule_plan_inspection import inspect_plan


def weekly():
    return compile_schedule(draft(), slots(), capabilities())[0]["body"]


def test_period_order_is_canonical_but_changed_time_is_not_equal():
    wanted = weekly()
    actual = deepcopy(wanted)
    actual["UserRightWeekPlanCfg"]["WeekPlanCfg"].reverse()
    assert compare_resource("weekly", wanted, actual)["state"] == "matches"
    actual["UserRightWeekPlanCfg"]["WeekPlanCfg"][-1]["TimeSegment"]["beginTime"] = "10:00:00"
    assert compare_resource("weekly", wanted, actual)["fields"] == ["WeekPlanCfg"]


@pytest.mark.parametrize(
    "case", ["extra_root", "extra_period", "bad_time", "duplicate", "missing", "boolean_id"]
)
def test_unrecognized_or_malformed_observations_never_match_or_echo(case):
    wanted = weekly()
    actual = deepcopy(wanted)
    node = actual["UserRightWeekPlanCfg"]
    rows = node["WeekPlanCfg"]
    if case == "extra_root":
        node["PRIVATE_KEY"] = "PRIVATE_VALUE"
    if case == "extra_period":
        rows[0]["authenticationTimesEnabled"] = True
    if case == "bad_time":
        rows[0]["TimeSegment"]["endTime"] = "PRIVATE_TIME"
    if case == "duplicate":
        rows[1] = deepcopy(rows[0])
    if case == "missing":
        rows[0].pop("TimeSegment")
    if case == "boolean_id":
        rows[0]["id"] = True
    result = compare_resource("weekly", wanted, actual)
    assert result["state"] in {"unreadable", "unsupported"}
    assert "PRIVATE" not in json.dumps(result)


def test_missing_disabled_slots_is_a_difference_not_equivalent():
    wanted = weekly()
    actual = deepcopy(wanted)
    actual["UserRightWeekPlanCfg"]["WeekPlanCfg"] = actual["UserRightWeekPlanCfg"]["WeekPlanCfg"][
        :1
    ]
    assert compare_resource("weekly", wanted, actual)["state"] == "different"
    assert compare_resource("weekly", wanted, None)["state"] == "not_observed"


@pytest.mark.parametrize("with_fingerprints", [False, True])
async def test_only_explicitly_selected_rows_are_captured_without_public_leak(with_fingerprints):
    private, evidence = {}, {}
    async with httpx.AsyncClient(
        transport=transport(
            total={k: 2 for k in ("template", "weekly", "holiday_group", "holiday")}
        )
    ) as session:
        result = await inspect_inventory(
            HikvisionClient(session, SETTINGS),
            selected={"template": {2}},
            records=private,
            evidence=evidence,
            fingerprint=(lambda value: "a" * 64) if with_fingerprints else None,
        )
    assert set(private["template"]) == {"2"}
    if with_fingerprints:
        assert set(evidence["template"]["rows"]) == {"1", "2"}
        assert set(evidence["template"]["rows"].values()) == {"a" * 64}
    assert all(not private[k] for k in ("weekly", "holiday_group", "holiday"))
    assert "PRIVATE" not in json.dumps(result)


async def test_plan_inspection_blocks_unknown_users_and_external_dependencies():
    caps = capabilities()

    async def inventory(client, *, selected, records, projected, **kwargs):
        candidates = compile_schedule(draft(), slots(), caps)
        records.update({r["kind"]: {str(r["id"]): r["body"]} for r in candidates})
        projected.update(template=[{"id": 99, "week": 20, "references": []}])
        return {
            "complete": True,
            "checks": [
                {"kind": kind, "capabilities": cap, "state": "complete"}
                for kind, cap in caps.items()
            ],
        }

    dependency = {
        "users_checked": True,
        "users": {
            "state": "complete",
            "read": 3,
            "explicit": 0,
            "implicit": 3,
            "malformed": 0,
            "error": None,
        },
    }
    with (
        patch(
            "custom_components.hikvision_intercom.client.schedule_plan_inspection.inspect_inventory",
            inventory,
        ),
        patch(
            "custom_components.hikvision_intercom.client.schedule_plan_inspection.read_user_dependencies",
            AsyncMock(return_value=dependency),
        ),
    ):
        async with httpx.AsyncClient() as session:
            result = await inspect_plan(
                HikvisionClient(session, SETTINGS), draft(), slots(), lambda v: "PRIVATE_HASH"
            )
    assert all(r["state"] == "matches" for r in result["report"]["resources"])
    assert "schedule_plan_external_references" in result["report"]["blockers"]
    assert "schedule_plan_user_defaults" in result["report"]["blockers"]
    assert "schedule_writes_unverified" in result["report"]["blockers"]
    assert not result["report"]["can_apply"] and "PRIVATE" not in json.dumps(result["report"])
