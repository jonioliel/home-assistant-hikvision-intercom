"""Observed bounds, comparable samples, uncertainty and resource limits."""

from copy import deepcopy
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.capacity_history import MAX_TOTAL, CapacityHistory

NOW = datetime(2026, 9, 29, 2, tzinfo=UTC)
BASE = {
    "at": NOW.isoformat(),
    "identity_stamp": "a" * 64,
    "users": 80,
    "cards": 100,
    "max_users": 100,
    "max_cards": 1000,
}


def sample(offset, **fields):
    return {**BASE, "at": (NOW + timedelta(days=offset)).isoformat(), **fields}


async def test_unknown_limits_never_become_free_capacity_or_forecasts():
    history = CapacityHistory(AsyncMock())
    await history.observe({"one": {**BASE, "max_users": None, "max_cards": None}}, NOW)
    records = history.report({"one": "Main", "new": "No inventory"}, NOW)["records"]
    for row in records:
        for key in ["users", "cards"]:
            assert row[key]["advertised_limit"] is None
            assert row[key]["remaining"] is None
            assert row[key]["estimated_days_to_limit"] is None
            assert row[key]["alert"] == "unknown"
        assert row["programs"]["alert"] == "unknown"


async def test_forecast_requires_three_comparable_samples_spanning_day():
    history = CapacityHistory(AsyncMock())
    for offset, count in [(-2, 60), (-1, 70), (0, 80)]:
        await history.observe({"one": sample(offset, users=count)}, NOW)
    row = history.report({"one": "Main"}, NOW)["records"][0]
    assert row["sample_count"] == 3
    assert row["users"]["observed_growth_per_day"] == 10
    assert row["users"]["estimated_days_to_limit"] == 2
    assert row["users"]["alert"] == "near_limit"
    assert row["cards"]["estimated_days_to_limit"] is None
    stale = history.report({"one": "Main"}, NOW + timedelta(hours=2))["records"][0]
    assert not stale["fresh"] and stale["users"]["estimated_days_to_limit"] is None
    assert stale["users"]["alert"] == "stale"


@pytest.mark.parametrize(
    "changed", [{"identity_stamp": "b" * 64}, {"max_users": 200, "identity_stamp": "b" * 64}]
)
async def test_replacement_or_firmware_bounds_start_separate_baseline(changed):
    history = CapacityHistory(AsyncMock())
    for offset in [-2, -1]:
        await history.observe({"one": sample(offset)}, NOW)
    await history.observe({"one": {**sample(0), **changed}}, NOW)
    row = history.report({"one": "Main"}, NOW)["records"][0]
    assert row["sample_count"] == 1
    assert row["users"]["observed_growth_per_day"] is None


async def test_identical_stale_future_and_too_close_inventory_are_not_new_samples():
    save = AsyncMock()
    history = CapacityHistory(save)
    await history.observe({"one": BASE}, NOW)
    await history.observe({"one": BASE}, NOW)
    await history.observe(
        {"one": {**BASE, "at": (NOW + timedelta(minutes=1)).isoformat(), "users": 81}},
        NOW + timedelta(minutes=1),
    )
    await history.observe({"old": sample(-40), "future": sample(1)}, NOW)
    assert save.await_count == 1
    assert len(history.data["stations"]["one"]) == 1
    assert set(history.data["stations"]) == {"one"}


async def test_failed_save_preserves_previous_samples_and_restored_history_matches():
    history = CapacityHistory(AsyncMock())
    await history.observe({"one": sample(-1)}, NOW)
    before = deepcopy(history.data)
    history._save = AsyncMock(side_effect=OSError)
    with pytest.raises(OSError):
        await history.observe({"one": BASE}, NOW)
    assert history.data == before
    restored = CapacityHistory(AsyncMock())
    restored.load(before)
    assert restored.report({"one": "Main"}, NOW) == history.report({"one": "Main"}, NOW)


@pytest.mark.parametrize(
    "field,value",
    [
        ("users", True),
        ("max_cards", 0),
        ("identity_stamp", "identity"),
        ("at", "2026-09-29"),
        ("pin", "SECRET"),
    ],
)
async def test_corrupt_storage_does_not_become_empty_working_history(field, value):
    history = CapacityHistory(AsyncMock())
    data = {"schema": 1, "stations": {"one": [{**BASE, field: value}]}}
    with pytest.raises(AccessError, match="storage_corrupt"):
        history.load(data)


async def test_declining_or_short_history_does_not_claim_positive_growth():
    history = CapacityHistory(AsyncMock())
    for offset, count in [(-2, 90), (-1, 80), (0, 70)]:
        await history.observe({"one": sample(offset, users=count)}, NOW)
    value = history.report({"one": "Main"}, NOW)["records"][0]["users"]
    assert value["observed_growth_per_day"] == -10
    assert value["estimated_days_to_limit"] is None


async def test_bounded_history_preserves_recent_data_with_explicit_budget():
    history = CapacityHistory(AsyncMock())
    # 200 stations is independent of any nine-station installation.
    observations = {f"station-{i}": sample(-3) for i in range(200)}
    await history.observe(observations, NOW)
    for index in range(32):
        at = NOW - timedelta(days=2) + timedelta(minutes=10 * index)
        await history.observe({sid: {**BASE, "at": at.isoformat()} for sid in observations}, NOW)
    assert sum(map(len, history.data["stations"].values())) <= MAX_TOTAL
    assert len(history.data["stations"]) == 200
    assert history.report({}, NOW)["history_budget"]["total_samples"] == MAX_TOTAL


async def test_dense_inventory_refresh_preserves_day_spanning_baseline():
    history = CapacityHistory(AsyncMock())
    await history.observe({"one": sample(-2, users=40)}, NOW)
    for i in range(80):
        at = NOW - timedelta(hours=8) + timedelta(minutes=6 * i)
        await history.observe({"one": {**BASE, "at": at.isoformat(), "users": 80}}, NOW)
    row = history.report({"one": "Main"}, NOW)["records"][0]
    assert row["sample_span_days"] >= 1
    assert row["sample_count"] == 64
    assert row["users"]["observed_growth_per_day"] is not None
