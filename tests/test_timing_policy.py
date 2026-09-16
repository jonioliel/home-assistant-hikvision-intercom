"""Finite-window enforcement across real DST, recovery and independent synchronization."""

from copy import deepcopy
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest
from test_access_engine import create_user
from test_access_engine import setup as access_setup
from test_user_timing import weekly

from custom_components.hikvision_intercom.access import timing_policy
from custom_components.hikvision_intercom.access.csv_transfer import desired_fields
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.access.timing_policy import policy, rolling_validity

setup = access_setup


def active(schedule=None, mode="ha"):
    return {"mode": mode, "schedule": schedule or weekly(), "bindings": {}}


@pytest.mark.parametrize(
    "now,begin,end",
    [
        ("2026-09-14T08:59:00+00:00", "2026-09-14T09:00:00+00:00", "2026-09-14T15:00:00+00:00"),
        ("2026-09-14T09:00:00+00:00", "2026-09-14T09:00:00+00:00", "2026-09-14T15:00:00+00:00"),
        ("2026-09-14T14:59:59+00:00", "2026-09-14T09:00:00+00:00", "2026-09-14T15:00:00+00:00"),
        ("2026-09-14T15:00:00+00:00", "2026-09-17T09:00:00+00:00", "2026-09-17T15:00:00+00:00"),
    ],
)
def test_weekly_current_next_gap_and_exclusive_end(now, begin, end):
    actual = rolling_validity(weekly(), now=datetime.fromisoformat(now))
    assert actual == {"enable": True, "timeType": "UTC", "beginTime": begin, "endTime": end}


def test_separate_daily_periods_and_dates_never_bridge_gaps():
    schedule = {
        **weekly(),
        "mode": "dates",
        "days": [],
        "dates": ["2026-09-14", "2026-09-17"],
        "periods": [{"start": "09:00", "end": "12:00"}, {"start": "14:00", "end": "18:00"}],
    }
    now = datetime(2026, 9, 14, 9, tzinfo=UTC)
    result = rolling_validity(schedule, now=now)
    assert result["beginTime"] == "2026-09-14T11:00:00+00:00"
    assert result["endTime"] == "2026-09-14T15:00:00+00:00"
    expired = rolling_validity(schedule, now=datetime(2026, 9, 18, tzinfo=UTC))
    assert expired["enable"] and datetime.fromisoformat(expired["endTime"]) < now


@pytest.mark.parametrize("date,hours", [("2026-03-27", 23), ("2026-10-25", 25)])
def test_full_local_day_uses_dst_boundaries(date, hours):
    schedule = {
        **weekly(),
        "mode": "dates",
        "days": [],
        "dates": [date],
        "periods": [{"start": "00:00", "end": "24:00"}],
    }
    result = rolling_validity(schedule, now=datetime(2026, 1, 1, tzinfo=UTC))
    assert (
        datetime.fromisoformat(result["endTime"]) - datetime.fromisoformat(result["beginTime"])
    ).total_seconds() == hours * 3600


@pytest.mark.parametrize(
    "date,start,end", [("2026-03-27", "02:30", "04:00"), ("2026-10-25", "01:30", "03:00")]
)
def test_ambiguous_or_missing_boundary_denies_instead_of_widening(date, start, end):
    schedule = {
        **weekly(),
        "mode": "dates",
        "days": [],
        "dates": [date],
        "periods": [{"start": start, "end": end}],
    }
    now = datetime(2026, 1, 1, tzinfo=UTC)
    result = rolling_validity(schedule, now=now)
    assert result["enable"] and datetime.fromisoformat(result["endTime"]) < now


def test_global_validity_intersection():
    result = rolling_validity(
        weekly(),
        now=datetime(2026, 9, 14, 10, tzinfo=UTC),
        valid_from="2026-09-14T11:00:00+00:00",
        valid_until="2026-09-14T12:00:00+00:00",
    )
    assert result["beginTime"] == "2026-09-14T11:00:00+00:00"
    assert result["endTime"] == "2026-09-14T12:00:00+00:00"


@pytest.mark.parametrize(
    "patch", [{"mode": "automatic"}, {"schedule": None}, {"bindings": {"a": {}}}, {"extra": True}]
)
def test_policy_rejects_malformed_fields(patch):
    with pytest.raises(AccessError):
        policy({**active(), **patch})


async def test_active_policy_roundtrip_revision_and_metadata_preservation():
    repo = AccessRepository(AsyncMock())
    await repo.async_load(None)
    user = await create_user(repo)
    updated = await repo.async_update(
        user.id, {"access_timing_policy": active()}, expected_revision=user.revision
    )
    assert desired_fields(updated) != desired_fields(user)
    assert updated.assignments["a"].sync_state == "pending"
    updated = await repo.async_update(
        user.id, {"display_name": "Renamed"}, expected_revision=updated.revision
    )
    restored = AccessRepository(AsyncMock())
    await restored.async_load(deepcopy(repo.snapshot()))
    assert restored.get(user.id).access_timing_policy == policy(active())
    assert restored.snapshot()["schema"] == 10


class Frozen(datetime):
    value = datetime(2026, 9, 14, 10, tzinfo=UTC)

    @classmethod
    def now(cls, tz=None):
        return cls.value.astimezone(tz or UTC)


async def test_engine_renews_after_gap_without_resending_pin_and_survives_restart(
    setup, monkeypatch
):
    repo, device, driver, engine = setup
    monkeypatch.setattr(timing_policy, "datetime", Frozen)
    from custom_components.hikvision_intercom.client.clock import ClockClient

    monkeypatch.setattr(
        ClockClient,
        "async_read",
        AsyncMock(
            return_value={
                "measurement": {
                    "status": "measured",
                    "estimated_skew_seconds": 0,
                    "uncertainty_seconds": 1,
                }
            }
        ),
    )
    Frozen.value = datetime(2026, 9, 14, 10, tzinfo=UTC)
    user = await create_user(repo, access_timing_policy=active())
    assert (await engine.async_reconcile("a", driver)).failed == 0
    initial = deepcopy(device.users["1001"]["Valid"])
    assert initial["enable"] and initial["endTime"] == "2026-09-14T15:00:00+00:00"
    count = len(device.writes)
    assert (await engine.async_reconcile("a", driver)).failed == 0
    assert len(device.writes) == count
    Frozen.value = datetime(2026, 9, 14, 15, tzinfo=UTC)
    assert (await engine.async_reconcile("a", driver)).failed == 0
    changed = device.writes[-1][2]["UserInfo"]
    assert set(changed) == {"employeeNo", "Valid"}
    assert changed["Valid"]["beginTime"] == "2026-09-17T09:00:00+00:00"
    # An offline HA does not need to issue a revoke at end: device holds a finite Valid.
    assert datetime.fromisoformat(initial["endTime"]) <= Frozen.value
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    engine.repository = restored
    assert (await engine.async_reconcile("a", driver)).failed == 0
    assert (
        restored.public()["users"][0]["timing_readbacks"]["a"]["valid_from"]
        == changed["Valid"]["beginTime"]
    )
    user = await restored.async_update(user.id, {"active": False}, expected_revision=user.revision)
    assert (await engine.async_reconcile("a", driver)).failed == 0
    assert not device.users and not device.cards


async def test_failed_native_activation_expires_previous_managed_grant(setup):
    repo, device, driver, engine = setup
    user = await create_user(repo)
    await engine.async_reconcile("a", driver)
    await repo.async_update(
        user.id, {"access_timing_policy": active(mode="native")}, expected_revision=user.revision
    )
    result = await engine.async_reconcile("a", driver)
    assert result.failed == 1
    assert device.users["1001"]["Valid"]["enable"]
    assert device.users["1001"]["Valid"]["timeType"] == "local"
    assert datetime.fromisoformat(device.users["1001"]["Valid"]["endTime"]) < datetime(2001, 1, 1)
    assert repo.get(user.id).assignments["a"].sync_state == "error"


async def test_csv_roundtrip_cannot_turn_timed_user_into_unlimited():
    from custom_components.hikvision_intercom.access.csv_transfer import (
        export_users,
        parse_csv,
        row_patch,
    )
    from custom_components.hikvision_intercom.access.models import build_user

    repo = AccessRepository(AsyncMock())
    await repo.async_load(None)
    user = await create_user(repo, access_timing_policy=active())
    exported = export_users([user])
    row = parse_csv(exported)[0][1]
    patch = row_patch(row, None, {"a": "Synthetic"})
    imported = build_user(patch, employee_no=user.employee_no, now=user.created_at)
    assert imported.access_timing_policy == user.access_timing_policy
    assert "123456" not in exported


async def test_clock_failure_cannot_leave_previous_unlimited_grant(setup, monkeypatch):
    from custom_components.hikvision_intercom.client.clock import ClockClient

    repo, device, driver, engine = setup
    user = await create_user(repo)
    await engine.async_reconcile("a", driver)
    await repo.async_update(
        user.id, {"access_timing_policy": active()}, expected_revision=user.revision
    )
    monkeypatch.setattr(
        ClockClient,
        "async_read",
        AsyncMock(
            return_value={
                "measurement": {
                    "status": "measured",
                    "estimated_skew_seconds": 60,
                    "uncertainty_seconds": 1,
                }
            }
        ),
    )
    result = await engine.async_reconcile("a", driver)
    assert result.last_error == "schedule_station_clock_unverified"
    assert device.users["1001"]["Valid"]["enable"]
    assert device.users["1001"]["Valid"]["timeType"] == "local"
    assert datetime.fromisoformat(device.users["1001"]["Valid"]["endTime"]) < datetime(2001, 1, 1)


async def test_native_engine_binds_only_verified_plan_and_can_return_to_ha(setup, monkeypatch):
    from custom_components.hikvision_intercom.client.clock import ClockClient

    repo, device, driver, engine = setup
    plans = [{"doorNo": 1, "planTemplateNo": "10"}]

    class VerifiedNative:
        async def ensure(self, station, user, access, doors):
            access._verified_right_plans[user.employee_no] = deepcopy(plans)
            return deepcopy(plans)

        def owns(self, station, user, observed):
            return observed == plans

    engine.native_timing = VerifiedNative()
    user = await create_user(repo, access_timing_policy=active(mode="native"))
    assert (await engine.async_reconcile("a", driver)).failed == 0
    assert device.users["1001"]["RightPlan"] == plans
    user = await repo.async_update(
        user.id, {"display_name": "Renamed"}, expected_revision=user.revision
    )
    assert (await engine.async_reconcile("a", driver)).failed == 0
    assert set(device.writes[-1][2]["UserInfo"]) == {"employeeNo", "name"}
    await repo.async_update(
        user.id, {"access_timing_policy": active()}, expected_revision=user.revision
    )
    monkeypatch.setattr(
        ClockClient,
        "async_read",
        AsyncMock(
            return_value={
                "measurement": {
                    "status": "measured",
                    "estimated_skew_seconds": 0,
                    "uncertainty_seconds": 1,
                }
            }
        ),
    )
    assert (await engine.async_reconcile("a", driver)).failed == 0
    assert device.users["1001"]["RightPlan"] == []
    assert device.users["1001"]["Valid"]["enable"]


async def test_renewal_crossing_expiry_during_io_is_not_delayed_five_minutes(monkeypatch):
    repo = AccessRepository(AsyncMock())
    await repo.async_load(None)
    user = await create_user(repo, access_timing_policy=active())
    user.assignments["a"].sync_state = "synced"
    monkeypatch.setattr(timing_policy, "datetime", Frozen)
    Frozen.value = datetime(2026, 9, 14, 15, 0, 1, tzinfo=UTC)
    bindings = {
        user.id: {
            "timing_readback": {
                "mode": "ha",
                "revision": user.revision,
                "valid_until": "2026-09-14T15:00:00+00:00",
            }
        }
    }
    assert timing_policy.renewal_delay([user], "a", bindings=bindings) == 1
    user.assignments["a"].sync_state = "error"
    assert timing_policy.renewal_delay([user], "a", bindings=bindings) == 300
