"""Observed firmware search contract, pagination boundaries, privacy and draft limits."""

import asyncio
import json
from copy import deepcopy
from pathlib import Path

import httpx
import pytest
from test_client import SETTINGS
from test_schedules import CAPS, FLAGS, draft, holiday

from custom_components.hikvision_intercom.access.schedule_assessment import assess
from custom_components.hikvision_intercom.client.client import HikvisionClient
from custom_components.hikvision_intercom.client.schedule_inventory import (
    SEARCH,
    inspect_inventory,
    search_capability,
)
from custom_components.hikvision_intercom.exceptions import HikvisionValidationError

OBSERVED = json.loads(
    (Path(__file__).parent / "fixtures/schedule_search_readonly.json").read_text()
)
CAP = OBSERVED["search_capability"]
FLAGS = {**FLAGS, **{flag: True for flag, _ in SEARCH.values()}}
ROOTS = {
    "template": "UserRightPlanTemplate",
    "weekly": "UserRightWeekPlanCfg",
    "holiday_group": "UserRightHolidayGroupCfg",
    "holiday": "UserRightHolidayPlanCfg",
}


def row(kind, identifier):
    value = deepcopy(OBSERVED["samples"][kind]["matchResults"][0])
    value[SEARCH[kind][1]] = identifier
    if kind == "template":
        value["weekPlanNo"] = identifier
    value["templateName"] = "PRIVATE_NAME"
    value["password"] = "PRIVATE_SECRET"
    return value


def transport(*, total=None, mutate=None, calls=None):
    total = total or {"template": 255, "weekly": 255, "holiday_group": 64, "holiday": 1024}

    def handler(request):
        if calls is not None:
            calls.append((request.method, request.url.path, request.content))
        path = request.url.path
        if path == "/ISAPI/AccessControl/capabilities":
            return httpx.Response(200, json=FLAGS)
        root = path.split("/")[3]
        kind = next(k for k, v in ROOTS.items() if v == root)
        if path.endswith("/Search/capabilities"):
            return httpx.Response(200, json=CAP)
        if path.endswith("/capabilities"):
            return httpx.Response(200, json=CAPS[root])
        assert request.method == "POST" and path.endswith("/Search")
        query = json.loads(request.content)
        assert query["enable"] is False and query["searchResultPosition"] <= 256
        start, size = query["searchResultPosition"], query["maxResults"]
        rows = [row(kind, i) for i in range(start, min(total[kind] + 1, start + size))]
        status = (
            "NO MATCH"
            if not total[kind]
            else "MORE"
            if start - 1 + len(rows) < total[kind]
            else "OK"
        )
        result = {
            "responseStatus": status,
            "totalMatches": total[kind],
            "numOfMatches": len(rows),
            "matchResults": rows,
        }
        if mutate:
            mutate(kind, query, result)
        return httpx.Response(200, json=result)

    return httpx.MockTransport(handler)


async def run_inventory(**kwargs):
    async with httpx.AsyncClient(transport=transport(**kwargs)) as session:
        return await inspect_inventory(HikvisionClient(session, SETTINGS))


async def test_live_contract_inventory_counts_partial_bounds_and_no_mutations_or_names():
    calls = []
    result = await run_inventory(calls=calls)
    assert [c["read"] for c in result["checks"]] == [255, 255, 64, 300]
    assert [c["state"] for c in result["checks"]] == ["complete", "complete", "complete", "partial"]
    assert result["checks"][1]["referenced"] == 255
    assert not result["complete"] and not result["can_apply"] and not result["ownership_checked"]
    assert "PRIVATE" not in json.dumps(result) and "matchResults" not in json.dumps(result)
    assert all(m == "GET" or (m == "POST" and p.endswith("/Search")) for m, p, _ in calls)
    assert len(calls) == 29


async def test_no_match_is_completed_query_but_does_not_enable_allocation():
    result = await run_inventory(total={k: 0 for k in ROOTS})
    assert result["complete"] and all(c["read"] == 0 for c in result["checks"])
    assert not result["can_apply"] and not result["users_checked"]


@pytest.mark.parametrize(
    "case",
    [
        "duplicate",
        "total_changes",
        "empty_more",
        "early_ok",
        "bad_count",
        "bad_id",
        "boolean_id",
        "bad_enable",
        "private_reference",
        "long_reference",
        "bad_no_match",
        "wrong_search",
        "unknown_status",
        "structured_status",
    ],
)
async def test_inconsistent_pages_never_become_complete(case):
    def mutate(kind, query, result):
        if kind != "template":
            return
        rows = result["matchResults"]
        if case == "duplicate":
            rows[1]["planTemplateID"] = rows[0]["planTemplateID"]
        elif case == "total_changes" and query["searchResultPosition"] > 1:
            result["totalMatches"] -= 1
        elif case == "empty_more":
            rows.clear()
            result["numOfMatches"] = 0
        elif case == "early_ok":
            result["responseStatus"] = "OK"
        elif case == "bad_count":
            result["numOfMatches"] += 1
        elif case == "bad_id":
            rows[0]["planTemplateID"] = 65535
        elif case == "boolean_id":
            rows[0]["planTemplateID"] = True
        elif case == "bad_enable":
            rows[0]["enable"] = "false"
        elif case == "private_reference":
            rows[0]["holidayGroupNo"] = "PRIVATE_SECRET"
        elif case == "long_reference":
            rows[0]["holidayGroupNo"] = "9" * 5000
        elif case == "bad_no_match":
            result["responseStatus"] = "NO MATCH"
        elif case == "wrong_search":
            result["searchID"] = "different"
        elif case == "structured_status":
            result["responseStatus"] = {"PRIVATE_SECRET": True}
        elif case == "unknown_status":
            result["responseStatus"] = "PRIVATE_SECRET"

    result = await run_inventory(mutate=mutate)
    assert result["checks"][0]["state"] == "failed"
    assert result["checks"][0]["enabled"] is None and not result["complete"]
    assert "PRIVATE" not in json.dumps(result)
    assert result["checks"][1]["referenced"] is None


@pytest.mark.parametrize(
    "key,value",
    [
        ("searchID", {"@min": 33, "@max": 64}),
        ("searchResultPosition", {"@min": 2, "@max": 256}),
        ("searchResultPosition", {"@min": True, "@max": 256}),
        ("maxResults", {"@min": 0, "@max": 100}),
        ("maxResults", {"@min": 51, "@max": 100}),
        ("enable", {"@opt": [True]}),
        ("enable", {"@opt": [0, 1]}),
    ],
)
def test_unverified_search_capabilities_do_not_generate_queries(key, value):
    with pytest.raises(HikvisionValidationError):
        search_capability({**CAP, key: value})


async def test_unsupported_search_does_not_probe_or_send_query():
    calls = []

    def handler(request):
        calls.append(request.url.path)
        return httpx.Response(200, json={k: False for k in FLAGS})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        result = await inspect_inventory(HikvisionClient(session, SETTINGS))
    assert calls == ["/ISAPI/AccessControl/capabilities"]
    assert all(c["state"] == "unsupported" for c in result["checks"])


async def test_failed_authentication_stops_remaining_requests():
    calls = []

    def handler(request):
        calls.append(request.url.path)
        return httpx.Response(403)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        result = await inspect_inventory(HikvisionClient(session, SETTINGS))
    assert len(calls) == 1 and all(c["error"] == "authentication_failed" for c in result["checks"])


async def test_private_request_lane_does_not_wait_for_normal_io_lock():
    async with httpx.AsyncClient(transport=transport(total={k: 0 for k in ROOTS})) as session:
        client = HikvisionClient(session, SETTINGS)
        async with client._io_lock:
            async with asyncio.timeout(1):
                result = await inspect_inventory(client)
    assert result["complete"]


async def test_reference_from_disabled_template_never_means_free_or_user_linkage():
    result = await run_inventory(total={k: 2 for k in ROOTS})
    weekly = result["checks"][1]
    assert weekly["disabled"] == 2 and weekly["referenced"] == 2
    assert not result["ownership_checked"] and not result["users_checked"]


async def test_basic_draft_fits_limits_but_never_enables_apply():
    inventory = await run_inventory()
    report = assess(draft(), inventory)
    assert report["state"] == "fits" and not report["can_apply"]
    assert report["requirements"]["weekly_periods"] == 1
    assert "schedule_inventory_incomplete" in report["blockers"]
    assert "schedule_ownership_unknown" in report["blockers"]


async def test_hour_precision_day_limit_and_unsupported_weekday_are_independent_constraints():
    inventory = await run_inventory(total={k: 2 for k in ROOTS})
    cap = inventory["checks"][1]["capabilities"]
    cap.update(precision="hour", period_ids=[1, 1], max_periods=1, weekdays=["Tuesday"])
    d = draft()
    d["weekly"]["Monday"] = [{"start": "09:30", "end": "10:00"}, {"start": "12:00", "end": "13:00"}]
    report = assess(d, inventory)
    exceeded = {c["key"] for c in report["limits"] if c["state"] == "exceeds"}
    assert {"weekly_precision", "weekly_per_day", "weekly_periods", "weekdays"} <= exceeded


async def test_holiday_reference_count_is_not_inferred_from_identifier_range():
    inventory = await run_inventory(total={k: 2 for k in ROOTS})
    d = draft()
    d["holidays"] = [holiday()]
    report = assess(d, inventory)
    assert report["state"] == "unknown" and report["requirements"]["holiday"] == 1
    assert (
        next(c for c in report["limits"] if c["key"] == "holiday_membership")["available"] is None
    )


async def test_missing_capabilities_are_unknown_not_zero_capacity():
    inventory = await run_inventory(total={k: 0 for k in ROOTS})
    inventory["checks"][1]["capabilities"] = None
    report = assess(draft(), inventory)
    assert report["state"] == "unknown"


async def test_changed_station_identity_prevents_inventory_requests():
    calls = []

    def handler(request):
        calls.append(request.url.path)
        return httpx.Response(
            200, json={"DeviceInfo": {"model": "DS-KV6124-E1", "serialNumber": "replacement"}}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        result = await inspect_inventory(
            HikvisionClient(session, SETTINGS, expected_identity="expected")
        )
    assert calls == ["/ISAPI/System/deviceInfo"]
    assert all(c["state"] == "failed" for c in result["checks"])
    assert not result["complete"]
