from datetime import UTC, datetime

import pytest

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.user_directory import query_users


def user(identifier: str, employee: str, name: str, **values):
    return {
        "id": identifier,
        "revision": values.pop("revision", 1),
        "employee_no": employee,
        "display_name": name,
        "phone": values.pop("phone", ""),
        "profile": values.pop("profile", {}),
        "group_ids": values.pop("group_ids", []),
        "assignments": values.pop("assignments", {}),
        "active": values.pop("active", True),
        "valid_from": values.pop("valid_from", None),
        "valid_until": values.pop("valid_until", None),
        "pin_configured": values.pop("pin_configured", False),
        "cards": values.pop("cards", []),
        **values,
    }


def query(records, **values):
    return query_users(
        records,
        query=values.pop("query", ""),
        filters=values.pop("filters", {"sort": "employee"}),
        offset=values.pop("offset", 0),
        limit=values.pop("limit", 2),
        snapshot=values.pop("snapshot", ""),
        now=datetime(2026, 9, 22, tzinfo=UTC),
        **values,
    )


def test_query_is_stable_bounded_and_reports_snapshot_changes():
    records = [user("c", "10", "Ten"), user("a", "2", "Two"), user("b", "1", "One")]
    first = query(records)
    assert [item["employee_no"] for item in first["records"]] == ["1", "2"]
    assert first["total"] == first["total_all"] == 3
    assert first["offset"] == 0 and first["next_offset"] == 2
    second = query(records, offset=2, snapshot=first["snapshot"])
    assert [item["employee_no"] for item in second["records"]] == ["10"]
    assert not second["stale"] and second["previous_offset"] == 0
    changed = [*records[:2], {**records[2], "revision": 2}]
    assert query(changed, snapshot=first["snapshot"])["stale"]


def test_query_matches_search_filters_validity_credentials_and_last_card_digits():
    records = [
        user(
            "a",
            "100",
            "Ada Admin",
            phone="0541234567",
            profile={"department": "HQ"},
            group_ids=["management"],
            pin_configured=True,
            cards=[{"enabled": True, "masked_number": "•••• 9876"}],
            assignments={"front": {"enabled": True}},
            valid_until="2026-09-21T00:00:00+00:00",
        ),
        user(
            "b",
            "101",
            "Ben Worker",
            assignments={"front": {"enabled": False}},
            valid_from="2026-09-23T00:00:00+00:00",
        ),
    ]
    assert query(records, query="123-456", limit=20)["records"][0]["id"] == "a"
    assert query(records, query="9876", limit=20)["records"][0]["id"] == "a"
    assert query(records, filters={"sort": "name", "group": "management"})["total"] == 1
    assert query(records, filters={"sort": "name", "profile": {"department": "HQ"}})["total"] == 1
    assert (
        query(records, filters={"sort": "name", "station": "front", "rights": "assigned"})[
            "records"
        ][0]["id"]
        == "a"
    )
    assert (
        query(records, filters={"sort": "name", "station": "front", "rights": "disabled"})[
            "records"
        ][0]["id"]
        == "b"
    )
    assert query(records, filters={"sort": "name", "state": "expired"})["records"][0]["id"] == "a"
    assert query(records, filters={"sort": "name", "state": "upcoming"})["records"][0]["id"] == "b"
    assert query(records, filters={"sort": "name", "credential": "pin"})["records"][0]["id"] == "a"
    assert (
        query(records, filters={"sort": "name", "credential": "no_card"})["records"][0]["id"] == "b"
    )


@pytest.mark.parametrize(
    "values",
    [
        {"limit": 0},
        {"limit": 201},
        {"offset": -1},
        {"query": "x" * 161},
        {"filters": {"sort": "unknown"}},
        {"filters": {"sort": "name", "unexpected": "value"}},
    ],
)
def test_query_rejects_unbounded_or_unknown_input(values):
    with pytest.raises(AccessError, match="invalid_fields"):
        query([user("a", "1", "Ada")], **values)
