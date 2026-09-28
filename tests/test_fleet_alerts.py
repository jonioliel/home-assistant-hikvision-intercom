"""Alert evidence, deduplication, scoped expiry and durable operator changes."""

import asyncio
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, Mock

import pytest

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.fleet_alerts import FleetAlerts, observed_alerts

NOW = datetime(2026, 9, 28, 3, 0, tzinfo=UTC)


def station(**values):
    return {
        "id": "front",
        "name": "Main gate",
        "online": True,
        "sync_state": "synced",
        "event_status": {"stream": "connected"},
        **values,
    }


def history(**values):
    return {
        "front": [
            {
                "at": (NOW - timedelta(minutes=30)).isoformat(),
                "online": True,
                "sync": "synced",
                "events": "connected",
                **values,
            },
            {
                "at": (NOW - timedelta(minutes=5)).isoformat(),
                "online": True,
                "sync": "synced",
                "events": "connected",
                **values,
            },
        ]
    }


@pytest.fixture
def alerts():
    return FleetAlerts(AsyncMock(), Mock())


@pytest.mark.parametrize(
    "current,samples,kind",
    [
        (station(online=False), history(online=False), "offline"),
        (station(sync_state="pending"), history(sync="pending"), "sync_stalled"),
        (station(sync_state="conflict"), history(sync="conflict"), "sync_conflict"),
        (station(sync_state="error"), history(sync="error"), "sync_error"),
        (
            station(event_status={"stream": "disconnected"}),
            history(events="disconnected"),
            "event_gap",
        ),
        (
            station(
                clock={
                    "status": "ready",
                    "drift_state": "repeated_ahead",
                    "checked_at": NOW.isoformat(),
                }
            ),
            history(),
            "clock_drift",
        ),
    ],
)
def test_alerts_are_one_per_station_kind_and_do_not_expose_access_data(
    alerts, current, samples, kind
):
    current.update(pin="secret", users=[{"phone": "private"}])
    result = alerts.report([current], samples, now=NOW)
    assert len(result["items"]) == 1 and result["items"][0]["id"] == f"front/{kind}"
    assert result == alerts.report([current], samples, now=NOW)
    assert "secret" not in str(result) and "private" not in str(result)
    assert result["revision"] == 0
    alerts._save.assert_not_called()


def test_short_disconnect_or_queue_is_not_a_long_alert(alerts):
    samples = history(online=False, sync="pending")
    samples["front"][0]["at"] = (NOW - timedelta(minutes=5)).isoformat()
    assert alerts.report([station(online=False)], samples, now=NOW)["items"] == []
    assert alerts.report([station(sync_state="pending")], samples, now=NOW)["items"] == []
    unknown = alerts.report([station(online=False)], {}, now=NOW)["items"][0]
    assert unknown["observed_seconds"] is None and unknown["observed_since"] is None


def test_current_contiguous_run_is_used_and_future_samples_are_ignored():
    samples = history(online=False)
    samples["front"].insert(1, {"at": (NOW - timedelta(minutes=8)).isoformat(), "online": True})
    samples["front"].append({"at": (NOW + timedelta(days=1)).isoformat(), "online": False})
    assert observed_alerts([station(online=False)], samples, NOW) == []


@pytest.mark.parametrize(
    "clock",
    [
        {"status": "ready", "drift_state": "ahead", "checked_at": NOW.isoformat()},
        {"status": "stale", "drift_state": "repeated_ahead", "checked_at": NOW.isoformat()},
        {
            "status": "ready",
            "drift_state": "repeated_ahead",
            "checked_at": (NOW - timedelta(hours=2)).isoformat(),
        },
        {"status": "ready", "drift_state": "uncertain", "checked_at": NOW.isoformat()},
    ],
)
def test_clock_alert_requires_fresh_repeated_evidence(alerts, clock):
    assert alerts.report([station(clock=clock)], history(), now=NOW)["items"] == []


async def test_snooze_is_scoped_and_expires_without_mutating_device_or_storage(alerts):
    await alerts.action(
        0, "front", "sync_conflict", "suppress", 15, "investigating", "operator", now=NOW
    )
    stations = [station(sync_state="conflict", event_status={"stream": "retrying"})]
    samples = history(sync="conflict", events="retrying")
    report = alerts.report(stations, samples, include_suppressed=True, now=NOW)
    assert report["active_count"] == report["suppressed_count"] == 1
    assert next(row for row in report["items"] if row["kind"] == "sync_conflict")["suppressed"]
    assert [row["kind"] for row in alerts.report(stations, samples, now=NOW)["items"]] == [
        "event_gap"
    ]
    before = deepcopy(alerts._data)
    expired = alerts.report(stations, samples, now=NOW + timedelta(minutes=16))
    assert expired["suppressed_count"] == 0 and expired["active_count"] == 2
    assert alerts._data == before
    alerts._save.assert_awaited_once()


async def test_maintenance_covers_only_selected_station_and_can_be_restored(alerts):
    await alerts.action(
        0, "front", "maintenance", "suppress", 60, "planned_maintenance", "operator", now=NOW
    )
    stations = [station(sync_state="error"), station(id="rear", sync_state="error")]
    report = alerts.report(stations, {}, include_suppressed=True, now=NOW)
    assert report["active_count"] == report["suppressed_count"] == 1
    restored = FleetAlerts(AsyncMock(), Mock())
    restored.load(alerts._data)
    assert restored.report(stations, {}, include_suppressed=True, now=NOW) == report
    await restored.action(1, "front", "maintenance", "restore", 0, "", "operator", now=NOW)
    assert restored.report(stations, {}, now=NOW)["active_count"] == 2


async def test_failure_and_stale_revision_do_not_publish_suppression(alerts):
    before = deepcopy(alerts._data)
    alerts._save.side_effect = OSError("disk unavailable")
    with pytest.raises(OSError):
        await alerts.action(
            0, "front", "maintenance", "suppress", 60, "planned_maintenance", "operator", now=NOW
        )
    assert alerts._data == before
    alerts._save.side_effect = None
    with pytest.raises(AccessError, match="revision_conflict"):
        await alerts.action(
            True, "front", "maintenance", "suppress", 60, "planned_maintenance", "operator", now=NOW
        )
    assert alerts._data == before


async def test_cancelled_persistence_keeps_lock_until_durable_commit(alerts):
    entered, finish = asyncio.Event(), asyncio.Event()

    async def delayed(_):
        entered.set()
        await finish.wait()

    alerts._save = delayed
    saving = asyncio.create_task(
        alerts.action(
            0, "front", "maintenance", "suppress", 60, "planned_maintenance", "operator", now=NOW
        )
    )
    await entered.wait()
    saving.cancel()
    await asyncio.sleep(0)
    saving.cancel()
    contender = asyncio.create_task(
        alerts.action(0, "front", "offline", "suppress", 15, "investigating", "other", now=NOW)
    )
    await asyncio.sleep(0)
    assert not contender.done() and alerts._data["revision"] == 0
    finish.set()
    with pytest.raises(asyncio.CancelledError):
        await saving
    with pytest.raises(AccessError, match="revision_conflict"):
        await contender
    assert alerts._data["revision"] == 1


def test_filters_paging_and_copies_are_safe(alerts):
    stations = [station(id=f"station-{index}", sync_state="conflict") for index in range(230)]
    report = alerts.report(stations, {}, limit=100, now=NOW)
    assert report["total"] == 230 and len(report["items"]) == report["next_offset"] == 100
    assert (
        alerts.report(stations, {}, station_id="station-15", kind="sync_conflict", now=NOW)["total"]
        == 1
    )
    for values in (
        {"limit": 201},
        {"offset": True},
        {"kind": "unknown"},
        {"include_suppressed": 1},
    ):
        with pytest.raises(AccessError):
            alerts.report(stations, {}, now=NOW, **values)


@pytest.mark.parametrize(
    "edit",
    [
        lambda row: row.update(kind="unknown"),
        lambda row: row.update(actor=""),
        lambda row: row.update(until="no-time"),
        lambda row: row.update(reason="arbitrary"),
    ],
)
async def test_corrupt_policy_is_rejected_and_preserved(alerts, edit):
    await alerts.action(
        0, "front", "maintenance", "suppress", 60, "planned_maintenance", "operator", now=NOW
    )
    raw = deepcopy(alerts._data)
    edit(raw["suppressions"]["front/maintenance"])
    before = deepcopy(raw)
    with pytest.raises(AccessError, match="invalid_storage"):
        FleetAlerts(AsyncMock(), Mock()).load(raw)
    assert raw == before
