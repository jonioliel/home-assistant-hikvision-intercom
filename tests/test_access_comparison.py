"""Read-only differences preserve explicit doors, exceptions and caller projection."""

from copy import deepcopy

import pytest

from custom_components.hikvision_intercom.access.access_comparison import compare, options
from custom_components.hikvision_intercom.access.models import AccessError

GROUPS = [
    {"id": "management", "label": "Management", "enabled": True, "station_ids": ["front", "rear"]},
    {"id": "staff", "label": "Staff", "enabled": True, "station_ids": ["front"]},
]
STATIONS = [{"id": "front", "name": "Front"}, {"id": "rear", "name": "Rear"}]


def person(uid="a", **patch):
    return {
        "id": uid,
        "display_name": uid,
        "active": True,
        "group_ids": ["management"],
        "assignments": {
            "front": {"enabled": True, "allowed_locks": [1, 2]},
            "rear": {"enabled": False, "allowed_locks": [1]},
        },
        "permission_overrides": {"rear": "deny"},
        "pin": "SECRET",
        "phone": "PHONE",
        **patch,
    }


def comparison(people, **patch):
    args = dict(left_kind="person", left_id="a", right_kind="group", right_id="management")
    args.update(patch)
    return compare(people, GROUPS, STATIONS, **args)


def test_person_group_exposes_explicit_relay2_and_personal_deny_without_copying_access():
    p = person()
    before = deepcopy(p)
    result = comparison([p])
    assert result["summary"] == {"shared": 1, "left_only": 1, "right_only": 1, "neither": 0}
    assert result["rows"][0]["left"]["source"] == "inherited"
    assert result["rows"][1]["right"]["granted"] is False
    assert result["rows"][2]["left"]["source"] == "personal_deny"
    assert result["right"]["name"] == "Management"
    assert result["rows"][0]["left"]["groups"][0]["name"] == "Management"
    assert p == before and "SECRET" not in str(result) and "PHONE" not in str(result)
    assert result["physical_result"] == "not_verified" and result["read_only"]


def test_group_overlap_and_disabled_groups_are_policy_not_current_admission():
    result = comparison([], left_kind="group", left_id="staff")
    assert result["summary"]["shared"] == 1 and result["summary"]["right_only"] == 1
    groups = deepcopy(GROUPS)
    groups[0]["enabled"] = False
    result = compare(
        [],
        groups,
        STATIONS,
        left_kind="group",
        left_id="management",
        right_kind="group",
        right_id="staff",
    )
    assert result["summary"]["right_only"] == 1 and result["summary"]["neither"] == 1


def test_person_person_and_inactive_flags_do_not_claim_current_admission():
    result = comparison(
        [
            person(),
            person(
                "b", active=False, assignments={"rear": {"enabled": True, "allowed_locks": [1]}}
            ),
        ],
        right_kind="person",
        right_id="b",
    )
    assert result["right"]["active"] is False and result["summary"]["right_only"] == 1
    assert result["left"]["active"] is True


def test_restricted_projection_never_reconstructs_hidden_group_membership():
    p = person(
        operator_editable=False,
        group_ids=[],
        assignments={"front": {"enabled": True, "allowed_locks": [1]}},
        permission_overrides={},
    )
    result = compare(
        [p],
        [GROUPS[1]],
        [STATIONS[0]],
        left_kind="person",
        left_id="a",
        right_kind="group",
        right_id="staff",
    )
    assert result["rows"][0]["left"]["source"] == "restricted"
    assert result["rows"][0]["left"]["sources_known"] is False
    assert "management" not in str(result) and "rear" not in str(result)
    with pytest.raises(AccessError, match="comparison_not_found"):
        compare(
            [p],
            [GROUPS[1]],
            [STATIONS[0]],
            left_kind="person",
            left_id="a",
            right_kind="group",
            right_id="management",
        )


@pytest.mark.parametrize(
    "patch",
    [
        {"kind": "wrong"},
        {"offset": True},
        {"offset": -1},
        {"limit": 0},
        {"limit": 101},
        {"query": "x" * 129},
    ],
)
def test_options_bounds(patch):
    args = dict(kind="person")
    args.update(patch)
    with pytest.raises(AccessError):
        options([person()], GROUPS, **args)


def test_paged_search_returns_only_names_and_preserves_filter():
    result = options([person("a"), person("b"), person("c")], GROUPS, kind="person", limit=1)
    assert result["next_offset"] == 1 and result["total"] == 3
    assert set(result["records"][0]) == {"id", "name", "archived"}
    assert options([person("a"), person("b")], [], kind="person", query="B")["total"] == 1
    result["records"][0]["name"] = "tampered"
    assert person()["display_name"] == "a"
