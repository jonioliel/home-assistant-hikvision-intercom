"""User schedules deny unselected days and preserve station-local time semantics."""

from copy import deepcopy

import pytest
from test_schedule_compiler import capabilities, slots
from test_user_timing import weekly

from custom_components.smplwise_access_control.access.models import AccessError
from custom_components.smplwise_access_control.access.schedules import preview
from custom_components.smplwise_access_control.access.user_timing_plan import (
    prepare_user_timing,
    right_plan,
    user_schedule,
)

USER_CAP = {
    "maxSize": 2,
    "maxPlanTemplate": 4,
    "doorNo": {"@min": 1, "@max": 2},
    "planTemplateNo": {"@min": 1, "@max": 255},
}


def test_weekly_boundary_and_unselected_days():
    plan = user_schedule(weekly())
    for day, time, allowed in [
        ("2026-09-14", "11:59", False),
        ("2026-09-14", "12:00", True),
        ("2026-09-14", "17:59", True),
        ("2026-09-14", "18:00", False),
        ("2026-09-15", "13:00", False),
        ("2026-09-17", "13:00", True),
    ]:
        assert preview(plan, day, time)["within_window"] is allowed
    assert weekly()["days"] == ["Thursday", "Monday"]


def test_selected_dates_do_not_recur_or_bridge_gaps():
    value = {
        **weekly(),
        "mode": "dates",
        "days": [],
        "dates": ["2026-09-14", "2026-09-15", "2026-09-17"],
    }
    plan = user_schedule(value)
    assert len(plan["holidays"]) == 2
    assert all(not periods for periods in plan["weekly"].values())
    for day, allowed in [
        ("2026-09-14", True),
        ("2026-09-15", True),
        ("2026-09-16", False),
        ("2026-09-17", True),
        ("2026-09-21", False),
        ("2027-09-14", False),
    ]:
        assert preview(plan, day, "13:00")["within_window"] is allowed


def test_compile_two_doors_keeps_local_time_and_never_claims_applied():
    value = prepare_user_timing(
        weekly(),
        slots(),
        capabilities(),
        doors=[2, 1],
        user_capability=USER_CAP,
        station_timezone="Asia/Jerusalem",
    )
    assert value["RightPlan"] == [
        {"doorNo": 1, "planTemplateNo": "10"},
        {"doorNo": 2, "planTemplateNo": "10"},
    ]
    assert not value["applied"] and not value["physical_verified"]
    periods = value["resources"][0]["body"]["UserRightWeekPlanCfg"]["WeekPlanCfg"]
    assert next(p for p in periods if p["enable"])["TimeSegment"]["beginTime"] == "12:00:00"


@pytest.mark.parametrize("zone", [None, "UTC", "UTC+03:00", "Europe/Athens"])
def test_current_offset_or_display_override_is_not_station_timezone_evidence(zone):
    with pytest.raises(AccessError, match="schedule_station_timezone_unverified"):
        prepare_user_timing(
            weekly(),
            slots(),
            capabilities(),
            doors=[1],
            user_capability=USER_CAP,
            station_timezone=zone,
        )


@pytest.mark.parametrize(
    "doors,template",
    [
        ([], 10),
        ([True], 10),
        ([1, 1], 10),
        ([3], 10),
        ([1], True),
        ([1], 65535),
        ([1], 65534),
        ([1], 65533),
    ],
)
def test_reserved_unrestricted_templates_and_invalid_doors_are_rejected(doors, template):
    with pytest.raises(AccessError):
        right_plan(doors, template, USER_CAP)


@pytest.mark.parametrize("field", ["maxSize", "maxPlanTemplate", "doorNo", "planTemplateNo"])
def test_missing_user_capability_cannot_be_inferred_from_schedule_support(field):
    caps = deepcopy(USER_CAP)
    caps.pop(field)
    with pytest.raises(AccessError):
        right_plan([1], 10, caps)


def test_date_windows_keep_full_day_at_dst_and_year_boundary():
    plan = user_schedule(
        {
            **weekly(),
            "mode": "dates",
            "days": [],
            "dates": ["2026-10-25", "2026-12-31", "2027-01-01"],
            "periods": [{"start": "00:00", "end": "24:00"}],
        }
    )
    assert plan["holidays"][-1]["end"] == "2027-01-01"
    assert preview(plan, "2026-10-25", "23:59")["within_window"]
    assert not preview(plan, "2026-10-26", "00:00")["within_window"]


def test_capability_can_include_reserved_ids_but_assignment_cannot_use_them():
    caps = deepcopy(USER_CAP)
    caps["planTemplateNo"]["@max"] = 65535
    assert right_plan([1], 10, caps) == [{"doorNo": 1, "planTemplateNo": "10"}]
    with pytest.raises(AccessError):
        right_plan([1], 65535, caps)
