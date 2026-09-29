"""Quality reads explain retained metadata without mutation or secret inspection."""

import json
from copy import deepcopy

import pytest

from custom_components.hikvision_intercom.access.data_quality import report
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.operator_scope import project_people, project_profiles
from custom_components.hikvision_intercom.panel_permissions import AREAS, normalize_policy


def person(uid, **extra):
    return {
        "id": uid,
        "revision": 1,
        "employee_no": uid,
        "display_name": uid,
        "phone": "",
        "profile": {},
        **extra,
    }


def policy():
    return {
        "revision": 1,
        "fields": [
            {"id": "role", "label": "Role", "enabled": True, "options": []},
            {
                "id": "badge",
                "label": "Badge",
                "enabled": True,
                "options": [],
                "type": "number",
                "required": True,
                "unique": True,
                "depends_on": {"field_id": "role", "value": "staff"},
            },
        ],
    }


def codes(row):
    return {i["code"] for i in row["issues"]}


def test_conditions_archives_and_uniqueness_are_explained_without_coercion():
    records = [
        person("a", profile={"role": "visitor", "badge": "2"}),
        person("b", profile={"role": "staff", "badge": "2.0"}, archived_at="archived"),
        person("c", profile={"role": "staff", "badge": "legacy"}),
        person("d", profile={"role": "staff"}),
    ]
    before = deepcopy(records)
    result = report(records, policy(), state="all")
    rows = {p["id"]: p for p in result["records"]}
    assert "duplicate_profile" in codes(rows["a"]) and rows["b"]["archived"]
    assert "profile_value_invalid" in codes(rows["c"])
    assert "profile_required" in codes(rows["d"])
    assert "profile_required" not in codes(rows["a"])
    assert "legacy" not in json.dumps(result)
    assert records == before
    assert report(records, policy(), state="current", kind="duplicate")["total"] == 1
    assert report(records, policy(), state="archived")["total"] == 1


def test_matching_names_and_israeli_phone_forms_are_candidates_not_secret_matches():
    people = [
        person("a", display_name="Ａda  Cohen", phone="054-123-4567", pin="646464"),
        person(
            "b", display_name="ada cohen", phone="+972541234567", cards=[{"card_no": "SECRET-CARD"}]
        ),
        person("c", phone="bad-phone"),
    ]
    result = report(people, {"fields": []})
    assert {"duplicate_display_name", "duplicate_phone"} <= codes(result["records"][0])
    payload = json.dumps(result)
    assert all(v not in payload for v in ["646464", "SECRET-CARD", "054-123-4567", "bad-phone"])
    assert any("invalid_phone" in codes(row) for row in result["records"])


def test_projection_precedes_duplicates_and_unknown_context_is_not_inferred():
    access = normalize_policy(
        {
            "enabled": True,
            "areas": dict.fromkeys(AREAS, "view"),
            "station_ids": ["front"],
            "fields": {
                k: "none" if k == "phone" else "view"
                for k in ["phone", "photo", "credentials", "profile", "access"]
            },
            "profile_fields": {"role": "none"},
        }
    )
    people = [
        person(
            "a", phone="", profile={"role": "staff", "badge": "PRIVATE"}, assignments={"front": {}}
        ),
        person("b", profile={"role": "staff", "badge": "PRIVATE"}, assignments={"elsewhere": {}}),
    ]
    result = report(project_people(access, people), project_profiles(access, policy()), scoped=True)
    assert result["coverage"] == {
        "scope": "visible",
        "scanned": 1,
        "archived": 0,
        "unknown_fields": 1,
    }
    assert result["summary"]["people"] == 0
    assert "PRIVATE" not in json.dumps(result) and result["records"] == []


def test_boundaries_staleness_and_many_duplicate_owners_are_bounded():
    people = [person(str(i), display_name="Shared") for i in range(2000)]
    first = report(people, {"fields": [], "revision": 1}, limit=2)
    assert len(first["records"]) == 2 and first["total"] == 2000
    issue = next(i for i in first["records"][0]["issues"] if i["kind"] == "duplicate")
    assert len(issue["related_ids"]) == 10 and issue["related_count"] == 1999
    assert first["records"][0]["id"] not in issue["related_ids"]
    second = report(
        people, {"fields": [], "revision": 1}, limit=2, offset=2, snapshot=first["snapshot"]
    )
    assert not second["stale"] and second["previous_offset"] == 0
    for profiles, context, changed in [
        ({"fields": [], "revision": 2}, "", people),
        ({"fields": [], "revision": 1}, "permission2", people),
        ({"fields": [], "revision": 1}, "", [{**people[0], "revision": 2}, *people[1:]]),
    ]:
        result = report(
            changed, profiles, snapshot=first["snapshot"], offset=2, permission_context=context
        )
        assert result["stale"] and not result["records"] and result["next_offset"] is None


@pytest.mark.parametrize(
    "arguments",
    [
        {"limit": 0},
        {"limit": 101},
        {"limit": True},
        {"offset": -1},
        {"offset": 1},
        {"kind": "pin"},
        {"state": None},
        {"snapshot": []},
    ],
)
def test_invalid_queries_fail_closed(arguments):
    with pytest.raises(AccessError, match="invalid_fields"):
        report([], {"fields": []}, **arguments)
