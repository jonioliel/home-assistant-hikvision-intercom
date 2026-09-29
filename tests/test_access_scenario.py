"""Predictions separate desired policy, historical evidence and physical outcomes."""

from copy import deepcopy

import pytest

from custom_components.hikvision_intercom.access.access_scenario import evaluate
from custom_components.hikvision_intercom.access.models import AccessError

AT = "2026-09-29T12:00:00+03:00"


def person(**patch):
    return {
        "revision": 4,
        "active": True,
        "archived_at": None,
        "assignments": {
            "front": {
                "enabled": True,
                "allowed_locks": [1],
                "sync_state": "synced",
                "desired_revision": 4,
                "applied_revision": 4,
            }
        },
        "valid_from": None,
        "valid_until": None,
        **patch,
    }


def timing(mode="ha"):
    return {
        "mode": mode,
        "bindings": {},
        "schedule": {
            "mode": "weekly",
            "timezone": "Asia/Jerusalem",
            "days": ["Tuesday"],
            "dates": [],
            "periods": [{"start": "09:00", "end": "17:00"}],
        },
    }


@pytest.mark.parametrize(
    ("patch", "lock", "reason"),
    [
        ({}, 1, "allowed"),
        ({"active": False}, 1, "inactive"),
        ({"archived_at": AT}, 1, "archived"),
        ({}, 2, "lock_not_assigned"),
        ({"assignments": {}}, 1, "no_assignment"),
        (
            {"valid_from": "2026-09-29T10:00:00+00:00", "valid_until": "2026-09-30T10:00:00+00:00"},
            1,
            "outside_validity",
        ),
    ],
)
def test_central_reasons_and_no_mutation(patch, lock, reason):
    p = person(**patch)
    before = deepcopy(p)
    result = evaluate(p, "front", lock, AT)
    assert result["desired"]["reason"] == reason
    assert result["physical_result"] == "not_verified" and result["read_only"]
    assert p == before


@pytest.mark.parametrize("mode", ["ha", "native"])
@pytest.mark.parametrize(
    ("at", "allow"),
    [
        ("2026-09-29T09:00:00+03:00", True),
        ("2026-09-29T16:59:59+03:00", True),
        ("2026-09-29T17:00:00+03:00", False),
        ("2026-09-30T12:00:00+03:00", False),
    ],
)
def test_both_timing_policies_use_current_window_and_exclusive_end(mode, at, allow):
    assert (
        evaluate(person(access_timing_policy=timing(mode)), "front", 1, at)["desired"]["allowed"]
        is allow
    )


@pytest.mark.parametrize("at", ["2026-09-29T12:00:00", "bad", "2038-01-01T00:00:00Z", True, ""])
def test_explicit_offset_bounded_time_required(at):
    with pytest.raises(AccessError, match="scenario_invalid_time"):
        evaluate(person(), "front", 1, at)


def test_dst_ambiguous_window_is_denied_not_widened():
    t = timing()
    t["schedule"].update(
        timezone="Europe/London", days=["Sunday"], periods=[{"start": "01:00", "end": "02:00"}]
    )
    assert not evaluate(person(access_timing_policy=t), "front", 1, "2026-10-25T01:30:00Z")[
        "desired"
    ]["allowed"]


def test_date_schedule_and_global_clip_and_draft():
    t = timing()
    t["schedule"].update(mode="dates", days=[], dates=["2026-09-29"])
    assert evaluate(person(access_timing_policy=t), "front", 1, AT)["desired"]["allowed"]
    assert not evaluate(person(access_timing_policy=t), "front", 1, "2026-09-30T09:00:00Z")[
        "desired"
    ]["allowed"]
    assert evaluate(person(access_timing_draft=t["schedule"]), "front", 1, AT)["desired"][
        "draft_ignored"
    ]


@pytest.mark.parametrize("mode", ["ha", "native"])
def test_readback_is_historical_whitelisted_and_native_does_not_claim_plan(mode):
    rb = {
        "mode": mode,
        "revision": 4,
        "checked_at": "2026-09-29T08:00:00Z",
        "valid_from": "2026-09-29T06:00:00Z",
        "valid_until": "2026-09-29T14:00:00Z",
        "pin": "SECRET",
        "fingerprint": "PRIVATE",
    }
    r = evaluate(
        person(access_timing_policy=timing(mode)),
        "front",
        1,
        AT,
        readback=rb,
        station_status="offline",
    )
    assert r["observed"]["timing"]["status"] == "historical"
    assert r["observed"]["timing"]["interval_contains_target"] is (True if mode == "ha" else None)
    assert r["station_status"] == "offline" and "SECRET" not in str(r) and "PRIVATE" not in str(r)
    rb["revision"] = 3
    r = evaluate(person(access_timing_policy=timing(mode)), "front", 1, AT, readback=rb)
    assert r["observed"]["timing"]["status"] == "previous_policy"
    assert r["observed"]["timing"]["interval_contains_target"] is None


@pytest.mark.parametrize("lock", [True, 0, 3, "1"])
def test_invalid_lock_rejected(lock):
    with pytest.raises(AccessError, match="invalid_lock"):
        evaluate(person(), "front", lock, AT)
