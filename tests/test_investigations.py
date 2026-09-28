"""Cross-source evidence must stay private, deterministic and identity-conservative."""

import json
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.access.investigations import query
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.events import normalize_event

NOW = datetime(2026, 9, 28, 2, 0, tzinfo=UTC)


async def example():
    repo = AccessRepository(AsyncMock())
    person = await repo.async_create(
        {"display_name": "Timeline person", "employee_no": "00042", "pin": "984619"}
    )
    await repo.async_bind("a", person.id, fingerprint="PRIVATE_FINGERPRINT")
    state = repo.snapshot()
    state["bindings"]["a"][person.id]["identity_observed_at"] = (
        NOW - timedelta(hours=2)
    ).isoformat()
    state["admin_audit"]["records"][0]["time"] = (NOW - timedelta(hours=1)).isoformat()
    state["admin_audit"]["records"][0]["actor"] = "operator-id"
    state["sync_operations"] = {
        person.id + "/a": {
            "id": "sync-id",
            "user_id": person.id,
            "station_id": "a",
            "intent": "SECRET_INTENT",
            "queued_at": (NOW - timedelta(minutes=40)).isoformat(),
            "updated_at": (NOW - timedelta(minutes=30)).isoformat(),
            "state": "verified",
            "verified_at": (NOW - timedelta(minutes=30)).isoformat(),
        }
    }
    event = normalize_event(
        {
            "major": 5,
            "minor": 1,
            "employeeNoString": "00042",
            "time": (NOW - timedelta(minutes=10)).isoformat(),
            "cardNo": "SECRET_CARD",
        },
        "a",
        b"x" * 32,
        received=NOW,
        selected_api=1,
        historical=True,
    )
    return state, [event], person.id


def report(state, events, **kwargs):
    return query(
        state,
        events,
        filters=kwargs.pop("filters", {}),
        offset=kwargs.pop("offset", 0),
        limit=kwargs.pop("limit", 100),
        snapshot=kwargs.pop("snapshot", ""),
        now=NOW,
        **kwargs,
    )


async def test_chronology_links_observed_identity_and_never_leaks_credentials():
    state, events, uid = await example()
    before = deepcopy(state)
    result = report(state, events)
    assert [row["source"] for row in result["records"]] == ["access", "sync", "change"]
    assert {row["user_id"] for row in result["records"]} == {uid}
    assert [row["evidence"] for row in result["records"]] == [
        "device_event",
        "device_readback",
        "desired_state_saved",
    ]
    assert result["summary"] == {"access": 1, "sync": 1, "change": 1}
    assert result["correlation"] == "chronology_is_not_causation"
    assert state == before
    assert "SECRET" not in json.dumps(result)
    assert "984619" not in json.dumps(result)
    assert "PRIVATE_FINGERPRINT" not in json.dumps(result)


@pytest.mark.parametrize(
    "case",
    [
        "pending",
        "later_owner",
        "received_time",
        "other_station",
        "reused_employee",
        "ambiguous",
        "deleted",
    ],
)
async def test_user_filter_never_guesses_event_owner(case):
    state, events, uid = await example()
    binding = state["bindings"]["a"][uid]
    if case == "pending":
        binding["fingerprint"] = None
    elif case == "later_owner":
        binding["identity_observed_at"] = NOW.isoformat()
    elif case == "received_time":
        events[0]["time_source"] = "received"
    elif case == "other_station":
        events[0]["station_id"] = "b"
    elif case == "reused_employee":
        state["users"][uid]["employee_no"] = "42"
    elif case == "ambiguous":
        state["users"]["other"] = deepcopy(state["users"][uid])
        state["bindings"]["a"]["other"] = deepcopy(binding)
    else:
        del state["users"][uid]
    focused = report(state, events, filters={"source": "access", "user_id": uid})
    assert focused["records"] == []
    unfocused = report(state, events, filters={"source": "access"})
    assert unfocused["records"][0]["details"]["identity_basis"] == "device_record_only"


async def test_paging_is_deterministic_and_marks_changed_evidence():
    state, events, _ = await example()
    first = report(state, events, limit=1)
    second = report(state, events, offset=1, limit=1, snapshot=first["snapshot"])
    assert not second["stale"] and second["records"][0]["source"] == "sync"
    state["sync_operations"][next(iter(state["sync_operations"]))]["state"] = "settled"
    changed = report(state, events, offset=1, limit=1, snapshot=first["snapshot"])
    assert changed["stale"] and changed["records"][0]["evidence"] == "sync_journal"
    assert report(state, events, offset=100, limit=1)["offset"] == 2


async def test_filters_normalize_zones_and_search_only_safe_fields():
    state, events, _ = await example()
    assert report(state, events, filters={"station_id": "a"})["total"] == 2
    assert report(state, events, filters={"query": "TIMELINE"})["total"] == 3
    assert report(state, events, filters={"query": "SECRET"})["total"] == 0
    limited = report(
        state,
        events,
        filters={"start": "2026-09-28T04:40:00+03:00", "end": "2026-09-28T05:00:00+03:00"},
    )
    assert limited["total"] == 1
    events[0]["received_at"] = (NOW - timedelta(days=31)).isoformat()
    state["admin_audit"]["records"][0]["time"] = (NOW - timedelta(days=31)).isoformat()
    assert report(state, events)["summary"] == {"access": 0, "sync": 1, "change": 0}


@pytest.mark.parametrize(
    "values",
    [
        {"filters": {"secret": "x"}},
        {"filters": {"source": []}},
        {"filters": {"user_id": True}},
        {"filters": {"query": "x" * 129}},
        {"filters": {"start": "2026-09-28T10:00:00"}},
        {"filters": {"start": "2026-09-28T10:00:00Z", "end": "2026-09-28T09:00:00Z"}},
        {"offset": -1},
        {"offset": True},
        {"limit": 201},
        {"snapshot": "x" * 65},
    ],
)
async def test_invalid_queries_are_rejected(values):
    state, events, _ = await example()
    with pytest.raises(AccessError, match="invalid_fields|invalid_text"):
        report(state, events, **values)
