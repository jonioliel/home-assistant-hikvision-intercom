"""Search only visible summaries; bound pages and preserve identity evidence."""

from copy import deepcopy

import pytest

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.unified_search import (
    action_rows,
    event_rows,
    people_rows,
    query,
)


def source(count=12):
    return {
        "people": people_rows(
            [
                {
                    "id": str(i),
                    "display_name": f"Person {i:02}",
                    "employee_no": str(1000 + i),
                    "phone": "050-123-4567",
                    "pin": "918472",
                    "cards": [{"masked_number": "••••7432", "card_no": "9876547432"}],
                }
                for i in range(count)
            ]
        ),
        "events": None,
        "actions": None,
    }


def run(sources=None, **options):
    return query(
        sources or source(), text="person", kind="all", offset=0, limit=25, snapshot="", **options
    )


def test_preview_counts_only_visible_sources_without_credentials():
    report = run()
    assert report["sections"]["people"]["total"] == 12
    assert len(report["sections"]["people"]["records"]) == 8
    assert report["sections"]["events"] == {
        "available": False,
        "total": None,
        "records": [],
        "next_offset": None,
        "previous_offset": None,
    }
    assert "918472" not in str(report) and "9876547432" not in str(report)
    assert "card_suffixes" not in str(report)


@pytest.mark.parametrize("text", ["0501234567", "050-123-4567", "7432", "PERSON 00"])
def test_known_public_text_and_normalized_phone_or_masked_suffix(text):
    result = query(source(), text=text, kind="people", offset=0, limit=10, snapshot="")
    assert result["sections"]["people"]["total"] > 0


def test_hidden_phone_and_credentials_cannot_match_or_change_snapshot():
    person = {
        "id": "one",
        "display_name": "Person",
        "employee_no": "42",
        "phone": "",
        "cards": [],
        "pin": "918472",
    }
    projected = {"people": people_rows([person]), "events": None, "actions": None}
    for text in ("0501234567", "918472", "7432"):
        assert (
            query(projected, text=text, kind="all", offset=0, limit=25, snapshot="")["sections"][
                "people"
            ]["total"]
            == 0
        )
    first = run(projected)
    person["pin"], person["revision"] = "882293", 88
    assert run({**projected, "people": people_rows([person])})["snapshot"] == first["snapshot"]


def test_pages_are_deterministic_and_stale_visible_revision_resets():
    rows = source()
    first = query(rows, text="person", kind="people", offset=0, limit=5, snapshot="")
    second = query(
        rows, text="person", kind="people", offset=5, limit=5, snapshot=first["snapshot"]
    )
    assert not second["stale"] and second["sections"]["people"]["previous_offset"] == 0
    assert {r["id"] for r in first["sections"]["people"]["records"]}.isdisjoint(
        r["id"] for r in second["sections"]["people"]["records"]
    )
    rows["people"][0]["name"] = "Changed person"
    stale = query(rows, text="person", kind="people", offset=5, limit=5, snapshot=first["snapshot"])
    assert stale["stale"] and stale["offset"] == 0
    assert run(permission_context="2")["snapshot"] != run(permission_context="3")["snapshot"]


@pytest.mark.parametrize(
    "options",
    [
        {"kind": "private"},
        {"offset": True},
        {"offset": -1},
        {"kind": "all", "offset": 1},
        {"limit": True},
        {"limit": 101},
        {"snapshot": "bad"},
        {"text": "a" * 161},
        {"text": "private\n"},
    ],
)
def test_invalid_search_is_rejected(options):
    data = {"text": "person", "kind": "all", "offset": 0, "limit": 25, "snapshot": ""}
    with pytest.raises(AccessError, match="invalid_fields"):
        query(source(), **{**data, **options})


def test_forbidden_selected_source_rejected_and_empty_query_does_not_dump_directory():
    with pytest.raises(AccessError, match="unauthorized"):
        query(source(), text="x", kind="actions", offset=0, limit=25, snapshot="")
    report = query(source(), text="  ", kind="all", offset=0, limit=25, snapshot="")
    assert (
        report["sections"]["people"]["total"] == 0 and not report["sections"]["people"]["records"]
    )


def test_events_keep_observed_identity_and_actions_keep_historical_names():
    event = {
        "id": "event",
        "station_id": "front",
        "person_name": "Old name",
        "employee_no": "12",
        "timestamp": "2030-01-01T00:00:00Z",
        "source": "query",
        "time_source": "device",
        "pin": "private",
    }
    action = {
        "sequence": 3,
        "time": event["timestamp"],
        "action": "users/update",
        "actor": "a",
        "before": {"display_name": "Old name"},
        "after": {"display_name": "New name", "employee_no": "12"},
        "fields": ["display_name"],
        "stations": ["front"],
    }
    rows = {
        "people": [],
        "events": event_rows([event], {"front": "Main door"}),
        "actions": action_rows([action], {"front": "Main door"}, {"a": "Manager"}),
    }
    result = query(rows, text="old name", kind="all", offset=0, limit=25, snapshot="")
    assert result["sections"]["events"]["total"] == result["sections"]["actions"]["total"] == 1
    assert result["sections"]["events"]["records"][0]["person_name"] == "Old name"
    assert "private" not in str(result)
    original = deepcopy(rows)
    query(rows, text="Manager", kind="actions", offset=0, limit=25, snapshot="")
    assert rows == original


def test_activity_in_another_source_does_not_reset_people_paging():
    sources = {**source(), "events": []}
    first = query(sources, text="person", kind="people", offset=0, limit=5, snapshot="")
    preview = query(sources, text="person", kind="all", offset=0, limit=5, snapshot="")
    sources["events"].append({"id": "new", "person_name": "Person event"})
    following = query(
        sources, text="person", kind="people", offset=5, limit=5, snapshot=first["snapshot"]
    )
    assert not following["stale"] and following["offset"] == 5
    assert following["snapshot"] == first["snapshot"]
    assert following["sections"]["events"]["total"] == 1
    combined = query(
        sources, text="person", kind="all", offset=0, limit=5, snapshot=preview["snapshot"]
    )
    assert combined["stale"]
