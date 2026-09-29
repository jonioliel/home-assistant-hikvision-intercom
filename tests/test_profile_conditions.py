"""Conditional graph primitives only; no production integration is claimed."""

from copy import deepcopy

import pytest

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.profile_conditions import (
    resolve_applicability,
    validate_conditions,
)


def field(key, parent=None, value="staff", enabled=True):
    result = {"id": key, "enabled": enabled}
    if parent is not None:
        result["depends_on"] = {"field_id": parent, "value": value}
    return result


def test_graph_evaluation_is_order_independent_and_preserves_hidden_values():
    fields = [field("badge", "department", "lab"), field("department", "role"), field("role")]
    values = {"role": "staff", "department": "lab", "badge": "preserved"}
    before = deepcopy((fields, values))
    assert resolve_applicability(fields, values) == {
        "role": True,
        "department": True,
        "badge": True,
    }
    values["role"] = "visitor"
    assert resolve_applicability(fields, values) == {
        "role": True,
        "department": False,
        "badge": False,
    }
    assert fields == before[0] and values["badge"] == "preserved"


@pytest.mark.parametrize("parent_value", ["Staff", "STAFF", "staff member", ""])
def test_conditions_match_exact_stored_values(parent_value):
    fields = [field("role"), field("badge", "role")]
    assert not resolve_applicability(fields, {"role": parent_value})["badge"]


def test_disabled_parent_prevents_children_even_when_preserved_value_matches():
    fields = [field("role", enabled=False), field("badge", "role")]
    assert resolve_applicability(fields, {"role": "staff"}) == {"role": False, "badge": False}


def test_explicit_empty_condition_distinguishes_disabled_and_applicable_parent():
    fields = [field("role"), field("badge", "role", "")]
    assert resolve_applicability(fields, {})["badge"]
    fields[0]["enabled"] = False
    assert not resolve_applicability(fields, {})["badge"]


@pytest.mark.parametrize(
    "fields",
    [
        [field("a", "a")],
        [field("a", "missing")],
        [field("a", "b"), field("b", "a")],
        [field("a", "b"), field("b", "c"), field("c", "a")],
        [field("a"), field("a")],
        [field(f"f_{i}") for i in range(13)],
        [{"id": "a", "enabled": 1}],
        [{"id": "a", "enabled": True, "depends_on": {"field_id": "b"}}],
        [{"id": "a", "enabled": True, "depends_on": "expression()"}],
        [
            field("a"),
            {
                "id": "b",
                "enabled": True,
                "depends_on": {"field_id": "a", "value": "x", "expression": "unsafe"},
            },
        ],
    ],
)
def test_invalid_graphs_are_rejected_without_mutating_definitions(fields):
    before = deepcopy(fields)
    with pytest.raises(AccessError):
        validate_conditions(fields)
    assert fields == before


def test_disabled_cycles_are_still_rejected_before_later_activation():
    with pytest.raises(AccessError):
        validate_conditions([field("a", "b", enabled=False), field("b", "a", enabled=False)])


def test_rules_are_normalized_without_mutating_input_and_null_clears_rule():
    fields = [field("role"), field("badge", "role", " staff ")]
    rules = validate_conditions(fields)
    assert rules["badge"] == {"field_id": "role", "value": "staff"}
    assert fields[1]["depends_on"]["value"] == " staff "
    fields[1]["depends_on"] = None
    assert validate_conditions(fields)["badge"] is None


def test_valid_maximum_chain_is_bounded_and_missing_context_does_not_coerce():
    fields = [field("f_0")] + [field(f"f_{i}", f"f_{i - 1}", "x") for i in range(1, 12)]
    assert all(resolve_applicability(fields, {f"f_{i}": "x" for i in range(12)}).values())
    with pytest.raises(AccessError):
        resolve_applicability(fields, {"f_0": 1})
