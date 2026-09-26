"""Draft semantics, durable storage, and no-write capability/readiness regressions."""

import asyncio
import json
from copy import deepcopy
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest
from test_client import SETTINGS

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.schedules import (
    DAYS,
    ScheduleLibrary,
    normalize,
    preview,
)
from custom_components.hikvision_intercom.client.client import HikvisionClient
from custom_components.hikvision_intercom.client.schedules import (
    ROUTES,
    capability,
    inspect_schedules,
)
from custom_components.hikvision_intercom.exceptions import (
    HikvisionAuthError,
    HikvisionValidationError,
)


def draft():
    return {
        "name": "Office",
        "weekly": {d: [{"start": "09:00", "end": "17:00"}] if d == "Monday" else [] for d in DAYS},
        "holidays": [],
    }


def holiday(start="2026-09-07", end="2026-09-08", windows=None):
    return {"name": "Closure", "start": start, "end": end, "periods": windows or []}


@pytest.mark.parametrize(
    "at,within",
    [("08:59", False), ("09:00", True), ("16:59", True), ("17:00", False), ("23:59", False)],
)
def test_week_boundary_semantics(at, within):
    result = preview(draft(), "2026-09-07", at)
    assert result["within_window"] is within
    assert result["source"] == "weekly" and result["applied"] is False
    assert result["basis"] == "draft_local_time"


def test_holiday_replaces_week_with_closed_day_and_inclusive_dates():
    d = draft()
    d["holidays"] = [holiday()]
    for day in ("2026-09-07", "2026-09-08"):
        p = preview(d, day, "12:00")
        assert not p["within_window"] and p["source"] == "holiday"
    assert preview(d, "2026-09-09", "12:00")["source"] == "weekly"
    d["holidays"][0]["periods"] = [{"start": "18:00", "end": "24:00"}]
    assert preview(d, "2026-09-07", "23:59")["within_window"]
    assert not preview(d, "2026-09-07", "12:00")["within_window"]


@pytest.mark.parametrize(
    "windows,error",
    [
        ([{"start": "17:00", "end": "09:00"}], "schedule_invalid_time"),
        ([{"start": "09:00", "end": "09:00"}], "schedule_invalid_time"),
        ([{"start": "24:00", "end": "24:00"}], "schedule_invalid_time"),
        ([{"start": "9:00", "end": "17:00"}], "schedule_invalid_time"),
        ([{"start": "09:60", "end": "17:00"}], "schedule_invalid_time"),
        ([{"start": "09:00:00", "end": "17:00"}], "schedule_invalid_time"),
        ([{"start": True, "end": "17:00"}], "schedule_invalid_time"),
        ([{"start": "09:00", "end": "17:00", "enable": False}], "schedule_invalid_time"),
        (
            [{"start": "09:00", "end": "17:00"}, {"start": "16:00", "end": "18:00"}],
            "schedule_overlap",
        ),
        ([{"start": "09:00", "end": "17:00"}] * 9, "schedule_period_limit"),
        (None, "schedule_period_limit"),
    ],
)
def test_invalid_windows_cannot_be_saved_or_previewed(windows, error):
    d = draft()
    d["weekly"]["Monday"] = windows
    with pytest.raises(AccessError, match=error):
        normalize(d)
    with pytest.raises(AccessError, match=error):
        preview(d, "2026-09-07", "12:00")


def test_sorting_preserves_adjacent_nonoverlapping_windows_and_input():
    d = draft()
    d["weekly"]["Monday"] = [{"start": "12:00", "end": "24:00"}, {"start": "00:00", "end": "12:00"}]
    before = deepcopy(d)
    canonical = normalize(d)
    assert d == before and canonical["weekly"]["Monday"][0]["start"] == "00:00"
    assert preview(d, "2026-09-07", "00:00")["within_window"]
    assert not preview(d, "2026-09-08", "00:00")["within_window"]


@pytest.mark.parametrize(
    "start,end",
    [
        ("2026-02-30", "2026-03-01"),
        ("2026-09-09", "2026-09-08"),
        ("1999-12-31", "2000-01-01"),
        ("2038-01-01", "2038-01-02"),
        ("20260907", "2026-09-08"),
        (True, "2026-09-08"),
    ],
)
def test_invalid_calendar_ranges(start, end):
    d = draft()
    d["holidays"] = [holiday(start, end)]
    with pytest.raises(AccessError, match="schedule_invalid_date"):
        normalize(d)


def test_overlapping_holidays_are_rejected_including_shared_boundary():
    d = draft()
    d["holidays"] = [holiday(), holiday("2026-09-08", "2026-09-09")]
    with pytest.raises(AccessError, match="schedule_holiday_overlap"):
        normalize(d)
    d["holidays"] = [holiday("2028-02-29", "2028-02-29")]
    assert normalize(d)["holidays"] == d["holidays"]
    d["holidays"] = [holiday()] * 65
    with pytest.raises(AccessError, match="schedule_holiday_limit"):
        normalize(d)
    del d["weekly"]["Sunday"]
    with pytest.raises(AccessError, match="schedule_invalid_week"):
        normalize(d)


async def test_durable_roundtrip_revision_delete_and_private_copies():
    save = AsyncMock()
    repo = ScheduleLibrary(save)
    await repo.async_load(None)
    item = await repo.async_save(draft())
    item["name"] = "tampered"
    assert repo.list()[0]["name"] == "Office"
    reloaded = ScheduleLibrary(save)
    await reloaded.async_load(save.call_args.args[0])
    saved = reloaded.list()[0]
    d = draft()
    d["name"] = "Updated"
    updated = await reloaded.async_save(d, schedule_id=saved["id"], revision=1)
    assert updated["revision"] == 2
    with pytest.raises(AccessError, match="revision_conflict"):
        await reloaded.async_delete(saved["id"], 1)
    await reloaded.async_delete(saved["id"], 2)
    assert reloaded.list() == [] and save.call_args.args[0]["schedules"] == {}


async def test_disk_failure_does_not_publish_changes():
    save = AsyncMock()
    repo = ScheduleLibrary(save)
    await repo.async_load(None)
    item = await repo.async_save(draft())
    before = repo.list()
    save.side_effect = OSError("disk")
    with pytest.raises(OSError):
        await repo.async_delete(item["id"], 1)
    with pytest.raises(OSError):
        await repo.async_save(draft())
    assert repo.list() == before


async def test_cancellation_finishes_durable_commit_before_release_of_lock():
    entered, release = asyncio.Event(), asyncio.Event()
    saved = []

    async def save(data):
        entered.set()
        await release.wait()
        saved.append(data)

    repo = ScheduleLibrary(save)
    task = asyncio.create_task(repo.async_save(draft()))
    await entered.wait()
    task.cancel()
    await asyncio.sleep(0)
    assert not task.done() and repo.list() == []
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(repo.list()) == 1 and saved[0]["schedules"]


async def test_concurrent_edit_cas_and_boolean_revision_rejected():
    repo = ScheduleLibrary(AsyncMock())
    item = await repo.async_save(draft())
    with pytest.raises(AccessError, match="revision_conflict"):
        await repo.async_save(draft(), schedule_id=item["id"], revision=True)
    results = await asyncio.gather(
        *(repo.async_save(draft(), schedule_id=item["id"], revision=1) for _ in range(2)),
        return_exceptions=True,
    )
    assert sum(isinstance(r, AccessError) for r in results) == 1
    assert repo.list()[0]["revision"] == 2


@pytest.mark.parametrize(
    "data",
    [
        [],
        {},
        {"schema": True, "schedules": {}},
        {"schema": 2, "schedules": {}},
        {"schema": 1, "schedules": []},
        {"schema": 1, "schedules": {"bad": {}}},
    ],
)
async def test_corruption_is_not_replaced(data):
    save = AsyncMock()
    repo = ScheduleLibrary(save)
    with pytest.raises(AccessError, match="invalid_storage"):
        await repo.async_load(data)
    save.assert_not_called()


async def test_corrupt_record_is_not_replaced_and_capacity_is_bounded(monkeypatch):
    save = AsyncMock()
    repo = ScheduleLibrary(save)
    await repo.async_save(draft())
    data = deepcopy(save.call_args.args[0])
    next(iter(data["schedules"].values()))["updated_at"] = "2026-09-07"
    with pytest.raises(AccessError, match="invalid_storage"):
        await repo.async_load(data)
    monkeypatch.setattr("custom_components.hikvision_intercom.access.schedules.MAX_SCHEDULES", 1)
    with pytest.raises(AccessError, match="schedule_limit"):
        await repo.async_save(draft())


EVIDENCE = json.loads(
    (Path(__file__).parent / "fixtures/schedule_capabilities_readonly.json").read_text()
)
CAPS = {r["root"]: r["payload"] for r in EVIDENCE["observations"] if r["item"] == "capabilities"}
FLAGS = {flag: True for _, _, flag, _ in ROUTES}


async def test_real_advertised_but_unreadable_contract_is_not_empty_or_write_ready():
    calls = []

    def handler(request):
        calls.append((request.method, request.url.path))
        path = request.url.path
        if path == "/ISAPI/AccessControl/capabilities":
            return httpx.Response(200, json=FLAGS)
        if path.endswith("/capabilities"):
            return httpx.Response(200, json=CAPS[path.split("/")[-2]])
        return httpx.Response(200, json={"statusCode": 3, "statusString": "Device Error"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        result = await inspect_schedules(HikvisionClient(session, SETTINGS))
    assert all(
        c["advertised"] and c["read_state"] == "failed" and c["error"] == "device_rejected"
        for c in result["checks"]
    )
    assert [c["capabilities"]["ids"][1] for c in result["checks"]] == [255, 255, 64, 1024]
    assert not result["can_apply"] and result["sample_only"]
    assert len(calls) == 9 and all(method == "GET" for method, _ in calls)
    assert "65535" not in str(calls)


@pytest.mark.parametrize("flag", [False, None, 1, "TRUE", [], {}])
async def test_no_interface_reads_without_explicit_support(flag):
    client = AsyncMock()
    client._get.return_value = {k: flag for k in FLAGS}
    result = await inspect_schedules(client)
    assert client._get.await_count == 1 and all(
        c["read_state"] == "unsupported" for c in result["checks"]
    )


async def test_readable_samples_are_private_and_never_enable_writes():
    async def get(path):
        if path == "/ISAPI/AccessControl/capabilities":
            return FLAGS
        root = path.split("/")[-2]
        if "/capabilities?" in path:
            return CAPS[root]
        return {
            root: {
                "enable": True,
                "templateName": "PRIVATE",
                "weekPlanNo": 1,
                "holidayGroupNo": "1",
                "groupName": "PRIVATE",
                "holidayPlanNo": "1",
                "WeekPlanCfg": [],
                "HolidayPlanCfg": [],
                "password": "SECRET",
            }
        }

    client = AsyncMock()
    client._get.side_effect = get
    result = await inspect_schedules(client)
    assert all(c["read_state"] == "readable" for c in result["checks"])
    assert not result["can_apply"] and "PRIVATE" not in str(result) and "SECRET" not in str(result)
    client.async_confirm_identity.assert_awaited_once()


async def test_identity_failure_stops_all_schedule_calls():
    client = AsyncMock()
    client.async_confirm_identity.side_effect = HikvisionAuthError("private")
    result = await inspect_schedules(client)
    client._get.assert_not_called()
    assert all(c["error"] == "authentication_failed" for c in result["checks"])


@pytest.mark.parametrize(
    "invalid",
    [
        None,
        {"@min": 0, "@max": 255},
        {"@min": True, "@max": 255},
        {"@min": 256, "@max": 255},
        {"@min": 1, "@max": 65536},
    ],
)
def test_invalid_capability_ranges_never_select_an_id(invalid):
    with pytest.raises(HikvisionValidationError):
        capability(
            {"UserRightPlanTemplate": {"templateNo": invalid}},
            "UserRightPlanTemplate",
            "templateNo",
        )
