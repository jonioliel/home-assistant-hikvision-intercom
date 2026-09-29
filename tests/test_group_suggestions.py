import json
from copy import deepcopy

import pytest

from custom_components.hikvision_intercom.access.group_suggestions import suggest
from custom_components.hikvision_intercom.access.models import AccessError

POLICY = {
    "revision": 3,
    "fields": [
        {
            "id": "department",
            "label": "Department",
            "enabled": True,
            "type": "select",
            "options": ["Operations", "Office"],
        },
        {"id": "role", "label": "Role", "enabled": True, "type": "text", "options": []},
    ],
    "groups": [
        {
            "id": "maintenance",
            "label": "Maintenance",
            "enabled": True,
            "station_ids": ["front", "back"],
        },
        {"id": "office", "label": "Office", "enabled": True, "station_ids": ["front"]},
    ],
}
STATIONS = [{"id": "front", "name": "Front"}, {"id": "back", "name": "Back"}]


def person(identity, groups=None, **patch):
    return {
        "id": identity,
        "revision": 1,
        "active": True,
        "profile": {"department": "Operations", "role": "Cleaner"},
        "group_ids": groups or [],
        "assignments": {},
        "permission_overrides": {},
        **patch,
    }


def run(people=None, policy=None, fields=None):
    return suggest(
        people or [person("target"), person("donor", ["maintenance"])],
        policy or POLICY,
        STATIONS,
        user_id="target",
        field_ids=["department"] if fields is None else fields,
    )


def test_evidence_and_blocks_preserved_without_mutation_or_credentials():
    people = [
        person(
            "target",
            assignments={"front": {"enabled": True, "allowed_locks": [2]}},
            permission_overrides={"back": "deny"},
            pin="827461",
            phone="secret-phone",
        ),
        person("donor", ["maintenance"], pin="918472"),
    ]
    before = deepcopy(people)
    result = run(people)
    assert result["suggestions"][0]["matching_members"] == 1
    assert result["suggestions"][0]["doors"] == [
        {
            "station_id": "front",
            "station_name": "Front",
            "before": [2],
            "after": [2],
            "blocked": False,
        },
        {"station_id": "back", "station_name": "Back", "before": [], "after": [], "blocked": True},
    ]
    assert (
        people == before
        and "827461" not in json.dumps(result)
        and "secret-phone" not in json.dumps(result)
    )
    assert result["read_only"] and result["physical_result"] == "not_verified"


def test_all_selected_fields_must_match_and_disabled_or_existing_groups_excluded():
    people = [
        person("target", ["office"]),
        person(
            "a", ["maintenance", "office"], profile={"department": "Operations", "role": "Manager"}
        ),
        person("b", ["office"]),
    ]
    assert run(people, fields=["department", "role"])["suggestions"] == []
    p = deepcopy(POLICY)
    p["groups"][0]["enabled"] = False
    assert run(people, p)["suggestions"] == []


def test_archive_inactive_and_unknown_memberships_are_not_evidence():
    people = [
        person("target"),
        person("a", ["maintenance"], active=False),
        person("b", ["maintenance"], archived_at="2026-09-29"),
        person("c", ["maintenance"], operator_editable=False),
    ]
    assert run(people)["suggestions"] == []


def test_eligible_fields_exclude_unique_invalid_and_unknown_descendants():
    p = deepcopy(POLICY)
    p["fields"][0]["unique"] = True
    p["fields"][1]["applicability_unknown"] = True
    p["fields"].append(
        {
            "id": "child",
            "label": "Child",
            "type": "text",
            "enabled": True,
            "options": [],
            "depends_on": {"field_id": "role", "value": "Cleaner"},
        }
    )
    assert run(policy=p, fields=[])["fields"] == []
    with pytest.raises(AccessError, match="field_access_denied"):
        run(policy=p)


def test_conditions_evaluated_and_invalid_selection_rejected():
    p = deepcopy(POLICY)
    p["fields"][1]["depends_on"] = {"field_id": "department", "value": "Office"}
    assert [f["id"] for f in run(policy=p, fields=[])["fields"]] == ["department"]
    with pytest.raises(AccessError, match="field_access_denied"):
        run(policy=p, fields=["role"])
    people = [
        person("target", profile={"department": "old-invalid", "role": "Cleaner"}),
        person("donor", ["maintenance"]),
    ]
    with pytest.raises(AccessError, match="field_access_denied"):
        run(people)


def test_only_visible_group_and_station_are_counted():
    p = deepcopy(POLICY)
    p["groups"] = p["groups"][1:]
    people = [person("target"), person("donor", ["maintenance", "office"])]
    result = run(people, p)
    assert len(result["suggestions"]) == 1 and result["suggestions"][0]["group_id"] == "office"
    assert "maintenance" not in json.dumps(result) and "Back" not in json.dumps(result)


def test_no_implicit_analysis_and_fingerprint_tracks_source_changes():
    people = [person("target"), person("donor", ["maintenance"])]
    assert run(people, fields=[])["suggestions"] == []
    a = run(people)
    people.append(person("second", ["maintenance"]))
    assert run(people)["fingerprint"] != a["fingerprint"]
    assert run(people)["fingerprint"] == run(people)["fingerprint"]


@pytest.mark.parametrize(
    "fields", [["department", "department"], [1], "department", ["a", "b", "c", "d"]]
)
def test_invalid_field_selection(fields):
    with pytest.raises(AccessError, match="invalid_fields"):
        run(fields=fields)


def test_missing_target_and_archived_target_are_not_applicable():
    with pytest.raises(AccessError, match="comparison_not_found"):
        run([person("other")])
    assert not run([person("target", archived_at="2026-09-29"), person("donor", ["maintenance"])])[
        "can_apply_to_draft"
    ]
