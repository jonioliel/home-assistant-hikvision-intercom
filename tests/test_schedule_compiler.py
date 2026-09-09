"""Candidate serialization follows vendor schema without granting write permission."""

from copy import deepcopy

import pytest
from test_schedules import CAPS, draft, holiday

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.schedule_compiler import (
    bindings_for,
    compile_schedule,
)
from custom_components.hikvision_intercom.access.schedules import DAYS
from custom_components.hikvision_intercom.client.schedules import ROUTES, capability


def capabilities():
    result = {kind: capability(CAPS[root], root, selector) for kind, root, _, selector in ROUTES}
    result["weekly"]["weekdays"] = list(DAYS)
    return result


def slots(holidays=0):
    return {
        "template": 10,
        "weekly": 20,
        "holiday_group": 3 if holidays else None,
        "holidays": list(range(30, 30 + holidays)),
    }


def test_full_week_clears_unused_slots_and_preserves_midnight_boundary():
    data = draft()
    data["weekly"]["Monday"] = [{"start": "09:30", "end": "24:00"}]
    plan = compile_schedule(data, slots(), capabilities())
    assert [r["kind"] for r in plan] == ["weekly", "template"]
    rows = plan[0]["body"]["UserRightWeekPlanCfg"]["WeekPlanCfg"]
    assert len(rows) == 56 and sum(r["enable"] for r in rows) == 1
    assert rows[0]["TimeSegment"] == {"beginTime": "09:30:00", "endTime": "24:00:00"}
    assert rows[1]["TimeSegment"] == {"beginTime": "00:00:00", "endTime": "00:00:00"}
    assert plan[1]["body"]["UserRightPlanTemplate"]["holidayGroupNo"] == ""
    assert not any("method" in r or "url" in r for r in plan)


def test_holiday_override_compiles_before_group_and_template_without_undocumented_fields():
    data = draft()
    data["holidays"] = [holiday()]
    plan = compile_schedule(data, slots(1), capabilities())
    assert [r["key"] for r in plan] == ["weekly:20", "holiday:30", "holiday_group:3", "template:10"]
    body = plan[1]["body"]["UserRightHolidayPlanCfg"]
    assert body["enable"] and not any(r["enable"] for r in body["HolidayPlanCfg"])
    assert body["beginDate"] == "2026-09-07" and "holidayPlanName" not in body
    assert plan[-1]["dependencies"] == ["weekly:20", "holiday_group:3"]
    assert plan[-2]["dependencies"] == ["holiday:30"]


@pytest.mark.parametrize("bad", [True, 0, -1, 65536, "1"])
def test_binding_values_are_strict_before_any_compilation(bad):
    with pytest.raises(AccessError, match="schedule_binding_invalid"):
        bindings_for({**slots(), "template": bad}, 0)


def test_duplicate_holiday_ids_and_unneeded_group_rejected():
    with pytest.raises(AccessError):
        bindings_for({**slots(2), "holidays": [30, 30]}, 2)
    with pytest.raises(AccessError):
        bindings_for(slots(1), 0)


@pytest.mark.parametrize("change", ["missing", "precision", "count", "weekdays", "name", "range"])
def test_incompatible_or_unknown_capabilities_reject_candidates(change):
    caps = deepcopy(capabilities())
    data = draft()
    if change == "missing":
        caps.pop("template")
    if change == "precision":
        caps["weekly"]["precision"] = "hour"
        data["weekly"]["Monday"][0]["start"] = "09:30"
    if change == "count":
        caps["weekly"]["max_periods"] = 7
    if change == "weekdays":
        caps["weekly"]["weekdays"] = ["Monday"]
    if change == "name":
        caps["template"].pop("name_length")
    if change == "range":
        caps["template"]["week_ids"] = [1, 10]
    with pytest.raises(AccessError):
        compile_schedule(data, slots(), caps)
