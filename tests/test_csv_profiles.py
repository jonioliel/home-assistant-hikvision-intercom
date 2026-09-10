"""CSV administration preserves policy provenance and validates before any mutation."""

import csv
import io
import json
from copy import deepcopy
from unittest.mock import Mock

import pytest
from test_beta_permissions import managed as managed  # noqa: F401
from test_csv_transfer import content

from custom_components.hikvision_intercom.access.csv_transfer import inspect_csv, parse_csv
from custom_components.hikvision_intercom.access.models import AccessError


async def test_group_profile_export_round_trip_is_noop_and_does_not_flatten_grants(managed):
    manager, user, _ = managed
    raw = (await manager.async_export_csv())["csv"]
    assert user.pin.value not in raw and user.cards[0].card_no.value not in raw
    parsed = parse_csv(raw)[0][1]
    assert parsed["stations"] == ""
    assert json.loads(parsed["group_ids"]) == ["staff"]
    assert json.loads(parsed["permission_overrides"]) == {"b": "deny"}
    assert json.loads(parsed["profile:department"]) == "Old"
    review = await manager.async_preview_csv(raw, "upsert")
    assert review["counts"] == {"create": 0, "update": 0, "unchanged": 1}
    assert review["errors"] == []
    manager.request = Mock()
    result = await manager.async_import_csv(raw, "upsert", review_token=review["review_token"])
    assert result["saved"] == 0 and manager.repository.get(user.id).revision == user.revision
    manager.request.assert_not_called()
    assert "a" not in manager.repository.get(user.id).permission_overrides


async def test_mapped_columns_preserve_unmentioned_fields_and_do_not_write_devices(managed):
    manager, user, _ = managed
    raw = content(
        [[user.employee_no, "Example", "Maintenance", "ignored"]],
        ("Employee", "Name", "Department", "Notes"),
    )
    mapping = {
        "Employee": "employee_no",
        "Name": "display_name",
        "Department": "profile:department",
        "Notes": "",
    }
    info = inspect_csv(raw)
    assert info["headers"] == list(mapping) and "Maintenance" not in str(info)
    review = await manager.async_preview_csv(raw, "upsert", mapping)
    assert review["rows"][0]["changed_fields"] == ["profile"]
    manager.request = Mock()
    await manager.async_import_csv(
        raw, "upsert", review_token=review["review_token"], column_map=mapping
    )
    updated = manager.repository.get(user.id)
    assert updated.profile == {"department": "Maintenance"}
    assert (
        updated.group_ids == user.group_ids
        and updated.permission_overrides == user.permission_overrides
    )
    assert updated.pin == user.pin and updated.cards == user.cards
    manager.request.assert_not_called()


async def test_changed_mapping_or_policy_invalidates_preview(managed):
    manager, user, profiles = managed
    raw = content([[user.employee_no, "Example", "Changed"]], ("id", "name", "custom"))
    mapping = {"id": "employee_no", "name": "display_name", "custom": "profile:department"}
    review = await manager.async_preview_csv(raw, "upsert", mapping)
    with pytest.raises(AccessError, match="csv_review_stale"):
        await manager.async_import_csv(
            raw, "upsert", review_token=review["review_token"], column_map={**mapping, "custom": ""}
        )
    values = deepcopy(profiles.data["values"])
    values["fields"][0]["label"] = "Building"
    await profiles.update(profiles.public()["revision"], values)
    with pytest.raises(AccessError, match="csv_review_stale"):
        await manager.async_import_csv(
            raw, "upsert", review_token=review["review_token"], column_map=mapping
        )


async def test_group_removal_retains_personal_denial_and_queues_offline_revoke(managed):
    manager, user, _ = managed
    raw = content(
        [[user.employee_no, "Example", "[]"]], ("employee_no", "display_name", "group_ids")
    )
    review = await manager.async_preview_csv(raw, "upsert")
    assert review["rows"][0]["access_removed"]
    await manager.async_import_csv(raw, "upsert", review_token=review["review_token"])
    changed = manager.repository.get(user.id)
    assert changed.group_ids == [] and changed.permission_overrides == {"b": "deny"}
    assert manager.stations["a"].pending and changed.pin == user.pin


async def test_multiple_cells_and_rows_report_codes_without_secrets_and_block_batch(managed):
    manager, user, _ = managed
    raw = content(
        [
            [user.employee_no, "Example", "bad-secret-pin", '"not-a-card-list"'],
            ["54321", "Other", "other-secret-pin", '"bad-list"'],
        ],
        ("employee_no", "display_name", "pin", "cards"),
    )
    before = manager.repository.snapshot()
    review = await manager.async_preview_csv(raw, "upsert")
    assert {(error["line"], error["column"]) for error in review["errors"]} == {
        (2, "pin"),
        (2, "cards"),
        (3, "pin"),
        (3, "cards"),
    }
    assert "secret" not in str(review) and review["review_token"] is None
    with pytest.raises(AccessError, match="csv_validation_failed"):
        await manager.async_import_csv(raw, "upsert", review_token="unknown")
    assert manager.repository.snapshot() == before


async def test_profile_json_strings_round_trip_literal_clear_formula_quote_and_empty(managed):
    manager, user, _ = managed
    for value in ["CLEAR", "=SUM(1)", "'leading", '"quoted"', "", "0012"]:
        updated = await manager.async_update(
            user.id,
            {"profile": {"department": value}},
            revision=manager.repository.get(user.id).revision,
            sync_now=False,
        )
        raw = (await manager.async_export_csv())["csv"]
        reader = list(csv.reader(io.StringIO(raw.removeprefix("\ufeff"))))
        assert all(not cell.startswith("=") for cell in reader[1])
        review = await manager.async_preview_csv(raw, "upsert")
        assert review["counts"]["unchanged"] == 1, (value, review)
        assert manager.repository.get(user.id).revision == updated["revision"]


async def test_ambiguous_groups_unknown_fields_and_absolute_conflict_are_blocked(managed):
    manager, user, profiles = managed
    values = deepcopy(profiles.data["values"])
    values["groups"].append({"id": "other", "label": "Staff", "enabled": True, "station_ids": []})
    await profiles.update(profiles.public()["revision"], values)
    for headers, cells, code in [
        (("group_ids",), ('["Staff"]',), "csv_group_ambiguous"),
        (("profile:missing",), ("Value",), "csv_profile_unknown"),
        (("stations", "permission_overrides"), ('{"a":true}', "{}"), "csv_permissions_conflict"),
    ]:
        raw = content(
            [[user.employee_no, "Example", *cells]], ("employee_no", "display_name", *headers)
        )
        review = await manager.async_preview_csv(raw, "upsert")
        assert review["errors"][0]["code"] == code and not review["review_token"]


def test_mapping_rejects_duplicate_targets_and_missing_identity():
    raw = content([["123", "Test", "Other"]], ("id", "name", "extra"))
    for mapping in [
        {"id": "employee_no", "name": "display_name", "extra": "display_name"},
        {"id": "", "name": "display_name", "extra": ""},
    ]:
        with pytest.raises(AccessError, match="csv_invalid_headers"):
            parse_csv(raw, mapping)
