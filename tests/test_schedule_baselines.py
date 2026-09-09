"""Baseline persistence, partial-search comparisons and private observation tokens."""

import asyncio
import json
from copy import deepcopy
from unittest.mock import AsyncMock

import httpx
import pytest
from test_client import SETTINGS
from test_schedule_inventory import ROOTS, transport

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.schedule_baselines import (
    KINDS,
    ScheduleBaselines,
    compare,
)
from custom_components.hikvision_intercom.client.client import HikvisionClient
from custom_components.hikvision_intercom.client.schedule_inventory import inspect_inventory

STAMP = "2026-09-09T10:00:00+00:00"
IDENTITY = "a" * 64


def snapshot(state="complete", count=2, total=None):
    return {
        kind: {
            "state": state,
            "total": count if total is None else total,
            "rows": {str(i): "b" * 64 for i in range(1, count + 1)},
            "capability": "c" * 64,
        }
        for kind in KINDS
    }


async def stored(data=None):
    save = AsyncMock()
    obj = ScheduleBaselines(save)
    await obj.async_load(data)
    return obj, save


def observe(obj, *, station="station", actor="admin", data=None, identity=IDENTITY):
    return obj.observe(station, actor, identity, STAMP, data or snapshot())


async def test_save_restart_and_compare_private_fingerprints_only():
    obj, save = await stored()
    evidence = {}
    async with httpx.AsyncClient(transport=transport(total={k: 2 for k in ROOTS})) as session:
        report = await inspect_inventory(
            HikvisionClient(session, SETTINGS), evidence=evidence, fingerprint=obj.fingerprint
        )
    response = observe(obj, data=evidence)
    assert response["state"] == "missing" and response["token"]
    assert save.await_count == 1  # observation alone does not persist
    await obj.async_save("station", "admin", IDENTITY, response["token"])
    data = save.call_args.args[0]
    assert "PRIVATE" not in json.dumps(data)
    restored, _ = await stored(data)
    assert restored.fingerprint({"name": "PRIVATE_NAME"}) == obj.fingerprint(
        {"name": "PRIVATE_NAME"}
    )
    result = observe(restored, data=evidence)
    assert result["state"] == "unchanged" and result["revision"] == 1
    assert "rows" not in json.dumps(result) and "capability" not in json.dumps(report)


async def test_same_counts_changed_window_is_detected_without_exposing_content():
    obj, _ = await stored()
    captures = []
    for end in ("17:00:00", "18:00:00"):

        def mutate(kind, query, result, end=end):
            result["matchResults"][0]["TimeSegment"] = {"endTime": end}

        evidence = {}
        async with httpx.AsyncClient(
            transport=transport(total={k: 2 for k in ROOTS}, mutate=mutate)
        ) as session:
            await inspect_inventory(
                HikvisionClient(session, SETTINGS), evidence=evidence, fingerprint=obj.fingerprint
            )
        captures.append(evidence)
    result = compare(*captures)
    assert result["state"] == "changed"
    assert all(c["modified"] == 1 and c["added"] == c["removed"] == 0 for c in result["checks"])
    assert "17:00" not in json.dumps(result) and "18:00" not in json.dumps(result)


def test_partial_new_read_never_proves_missing_record_was_removed():
    result = compare(snapshot(), snapshot("partial", 1, 10))
    assert result["state"] == "incomplete"
    assert all(c["removed"] == 0 and c["unverified_missing"] == 1 for c in result["checks"])


def test_partial_baseline_never_proves_later_record_was_added():
    result = compare(snapshot("partial", 1, 10), snapshot())
    assert result["state"] == "incomplete"
    assert all(c["added"] == 0 and c["unverified_new"] == 1 for c in result["checks"])


def test_complete_search_proves_presence_changes_with_bounded_id_list():
    result = compare(snapshot(count=1), snapshot(count=40))
    assert result["state"] == "changed"
    assert all(c["added"] == 39 and len(c["added_ids"]) == 20 for c in result["checks"])
    result = compare(snapshot(count=40), snapshot(count=1))
    assert all(c["removed"] == 39 and len(c["removed_ids"]) == 20 for c in result["checks"])


def test_capability_change_is_reported_even_when_rows_match():
    new = snapshot()
    new["weekly"]["capability"] = "d" * 64
    result = compare(snapshot(), new)
    assert result["state"] == "changed" and result["checks"][1]["capability_changed"]


def test_identical_partial_prefix_remains_incomplete():
    assert (
        compare(snapshot("partial", 2, 100), snapshot("partial", 2, 100))["state"] == "incomplete"
    )


async def test_identity_or_firmware_change_does_not_compare_unrelated_station():
    obj, _ = await stored()
    token = observe(obj)["token"]
    await obj.async_save("station", "admin", IDENTITY, token)
    result = observe(obj, identity="d" * 64)
    assert result["state"] == "identity_changed" and result["checks"] == []


@pytest.mark.parametrize(
    "field,value",
    [("actor", "other"), ("station", "other"), ("identity", "e" * 64), ("token", "invalid")],
)
async def test_tokens_are_bound_to_actor_station_and_identity(field, value):
    obj, save = await stored()
    args = dict(station="station", actor="admin", identity=IDENTITY, token=observe(obj)["token"])
    args[field] = value
    with pytest.raises(AccessError, match="schedule_baseline_expired"):
        await obj.async_save(**args)
    assert save.await_count == 1


async def test_observation_expiry_and_new_observation_invalidate_old_token():
    now = [10.0]
    obj = ScheduleBaselines(AsyncMock(), now=lambda: now[0])
    first = observe(obj)["token"]
    second = observe(obj)["token"]
    with pytest.raises(AccessError):
        await obj.async_save("station", "admin", IDENTITY, first)
    now[0] += 301
    with pytest.raises(AccessError):
        await obj.async_save("station", "admin", IDENTITY, second)


async def test_failed_save_preserves_previous_baseline_and_token_can_be_explicitly_retried():
    obj, save = await stored()
    token = observe(obj)["token"]
    await obj.async_save("station", "admin", IDENTITY, token)
    next_token = observe(obj, data=snapshot(count=1))["token"]
    save.side_effect = AccessError("storage_write_failed")
    with pytest.raises(AccessError):
        await obj.async_save("station", "admin", IDENTITY, next_token)
    assert obj.metadata("station")["revision"] == 1
    save.side_effect = None
    await obj.async_save("station", "admin", IDENTITY, next_token)
    assert obj.metadata("station")["revision"] == 2


async def test_cancellation_waits_for_atomic_save_and_never_loses_successful_state():
    entered, release = asyncio.Event(), asyncio.Event()

    async def save(_):
        entered.set()
        await release.wait()

    obj = ScheduleBaselines(save)
    token = observe(obj)["token"]
    task = asyncio.create_task(obj.async_save("station", "admin", IDENTITY, token))
    await entered.wait()
    task.cancel()
    await asyncio.sleep(0)
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert obj.metadata("station")["revision"] == 1
    with pytest.raises(AccessError):
        await obj.async_save("station", "admin", IDENTITY, token)


async def test_clear_revision_guard_and_pending_token_invalidation():
    obj, _ = await stored()
    await obj.async_save("station", "admin", IDENTITY, observe(obj)["token"])
    token = observe(obj)["token"]
    with pytest.raises(AccessError, match="revision_conflict"):
        await obj.async_clear("station", 0)
    await obj.async_clear("station", 1)
    assert obj.metadata("station")["revision"] == 0
    with pytest.raises(AccessError):
        await obj.async_save("station", "admin", IDENTITY, token)


async def test_entirely_failed_scan_cannot_replace_baseline():
    obj, _ = await stored()
    data = {
        kind: {"state": "failed", "rows": {}, "total": None, "capability": None} for kind in KINDS
    }
    assert observe(obj, data=data)["token"] is None


@pytest.mark.parametrize(
    "case",
    [
        "schema",
        "key",
        "stations",
        "revision",
        "time",
        "identity",
        "rows",
        "digest",
        "total",
        "state",
        "complete_count",
        "extra",
        "failed_rows",
    ],
)
async def test_corrupt_storage_is_rejected_without_overwrite(case):
    obj, save = await stored()
    await obj.async_save("station", "admin", IDENTITY, observe(obj)["token"])
    data = deepcopy(save.call_args.args[0])
    item = data["stations"]["station"]
    record = item["snapshot"]["weekly"]
    if case == "schema":
        data["schema"] = True
    if case == "key":
        data["key"] = "bad"
    if case == "stations":
        data["stations"] = []
    if case == "revision":
        item["revision"] = True
    if case == "time":
        item["checked_at"] = "2026-09-09"
    if case == "identity":
        item["identity"] = "PRIVATE"
    if case == "rows":
        record["rows"] = {"0001": "b" * 64}
    if case == "digest":
        record["rows"]["1"] = "PRIVATE"
    if case == "total":
        record["total"] = True
    if case == "state":
        record["state"] = []
    if case == "complete_count":
        record["total"] = 30
    if case == "extra":
        record["raw"] = "PRIVATE"
    if case == "failed_rows":
        record["state"] = "failed"
    sink = AsyncMock()
    with pytest.raises(AccessError, match="invalid_storage"):
        await ScheduleBaselines(sink).async_load(data)
    sink.assert_not_called()


async def test_different_installations_have_unlinkable_digests():
    a, _ = await stored()
    b, _ = await stored()
    assert a.fingerprint({"templateName": "PRIVATE"}) != b.fingerprint({"templateName": "PRIVATE"})


async def test_failed_later_page_drops_unreliable_fingerprints():
    obj, _ = await stored()
    evidence = {}

    def fingerprint(value):
        if isinstance(value, dict) and value.get("planTemplateID", 0) > 50:
            raise ValueError("unsupported raw field")
        return obj.fingerprint(value)

    async with httpx.AsyncClient(transport=transport()) as session:
        await inspect_inventory(
            HikvisionClient(session, SETTINGS), evidence=evidence, fingerprint=fingerprint
        )
    assert evidence["template"]["state"] == "failed" and not evidence["template"]["rows"]
    assert evidence["weekly"]["state"] == "complete"


async def test_bounded_station_store_does_not_evict_previous_references():
    obj, save = await stored()
    for i in range(16):
        station = f"station-{i}"
        await obj.async_save(station, "admin", IDENTITY, observe(obj, station=station)["token"])
    token = observe(obj, station="overflow")["token"]
    with pytest.raises(AccessError, match="schedule_baseline_limit"):
        await obj.async_save("overflow", "admin", IDENTITY, token)
    assert len(save.call_args.args[0]["stations"]) == 16
    await obj.async_clear("station-0", 1)
    await obj.async_save("overflow", "admin", IDENTITY, observe(obj, station="overflow")["token"])
    assert obj.metadata("station-1")["revision"] == 1


async def test_pending_observations_are_bounded_and_not_persisted():
    obj, save = await stored()
    for i in range(16):
        assert observe(obj, station=f"station-{i}")["token"]
    assert observe(obj, station="overflow")["token"] is None
    assert save.await_count == 1 and not save.call_args.args[0]["stations"]
