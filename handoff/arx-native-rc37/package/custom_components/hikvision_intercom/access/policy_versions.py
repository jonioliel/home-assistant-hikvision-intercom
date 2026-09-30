"""Bounded, immutable policy snapshots persisted with the central transaction."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from typing import Any

from .models import AccessError, text_field, utc_now

LIMIT = 50
KEYS = {"revision", "saved_at", "actor", "action", "origin", "values"}


def baseline(revision: int, values: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "revision": revision,
            "saved_at": None,
            "actor": "",
            "action": "baseline",
            "origin": "baseline",
            "values": deepcopy(values),
        }
    ]


def validate(records: Any, revision: int, values: dict[str, Any]) -> list[dict[str, Any]]:
    from ..profile_settings import normalize

    if not isinstance(records, list) or not 1 <= len(records) <= LIMIT:
        raise AccessError("invalid_storage")
    result = []
    previous = -1
    for row in records:
        if (
            not isinstance(row, dict)
            or set(row) != KEYS
            or type(row["revision"]) is not int
            or row["revision"] <= previous
        ):
            raise AccessError("invalid_storage")
        previous = row["revision"]
        if row["origin"] not in {"baseline", "saved"} or row["action"] not in {
            "baseline",
            "system",
            "profiles/settings_update",
            "bulk/group_policy",
            "platform/lifecycle_apply",
        }:
            raise AccessError("invalid_storage")
        text_field(row["actor"], 128, empty=True)
        if row["origin"] == "baseline":
            if row["saved_at"] is not None or row["actor"] or row["action"] != "baseline":
                raise AccessError("invalid_storage")
        else:
            if (
                not isinstance(row["saved_at"], str)
                or datetime.fromisoformat(row["saved_at"]).tzinfo is None
            ):
                raise AccessError("invalid_storage")
        result.append({**deepcopy(row), "values": normalize(row["values"])})
    if result[-1]["revision"] != revision or result[-1]["values"] != values:
        raise AccessError("invalid_storage")
    return result


def updated(
    prior: dict[str, Any] | None, desired: dict[str, Any], actor: str, action: str
) -> dict[str, Any]:
    # Never trust a preview's author or timestamp: capture the authenticated commit.
    records = deepcopy(prior["versions"]) if prior else []
    if prior and prior["revision"] == desired["revision"]:
        if prior["values"] != desired["values"]:
            raise AccessError("revision_conflict")
        return {**deepcopy(desired), "schema": 5, "versions": records}
    action = (
        action
        if action in {"profiles/settings_update", "bulk/group_policy", "platform/lifecycle_apply"}
        else "system"
    )
    records.append(
        {
            "revision": desired["revision"],
            "saved_at": utc_now(),
            "actor": actor,
            "action": action,
            "origin": "saved",
            "values": deepcopy(desired["values"]),
        }
    )
    return {**deepcopy(desired), "schema": 5, "versions": records[-LIMIT:]}


def rows(before: dict[str, Any], after: dict[str, Any]) -> list[dict[str, Any]]:
    result = []
    for kind, properties in (
        ("fields", ("label", "enabled", "type", "required", "unique", "options", "depends_on")),
        ("groups", ("label", "enabled", "station_ids")),
    ):
        old, new = ({v["id"]: v for v in side[kind]} for side in (before, after))
        for key in sorted(old.keys() | new.keys()):
            a, b = old.get(key), new.get(key)
            changes = []
            for prop in properties:
                left, right = a.get(prop) if a else None, b.get(prop) if b else None
                if left != right:
                    left, right = deepcopy(left), deepcopy(right)
                    if prop == "depends_on":
                        for value, definitions in ((left, old), (right, new)):
                            if value:
                                value["field_label"] = definitions.get(value["field_id"], {}).get(
                                    "label", value["field_id"]
                                )
                    changes.append({"property": prop, "before": left, "after": right})
            if a is None or b is None or changes:
                result.append(
                    {
                        "kind": kind,
                        "id": key,
                        "label": (b or a or {}).get("label", key),
                        "state": "added" if a is None else "removed" if b is None else "changed",
                        "changes": changes,
                    }
                )
    return result


def listing(policy: dict[str, Any], offset: int, limit: int) -> dict[str, Any]:
    if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 50:
        raise AccessError("invalid_fields")
    records = []
    for index, item in enumerate(policy["versions"]):
        differences = rows(policy["versions"][index - 1]["values"], item["values"]) if index else []
        records.append({k: item[k] for k in ("revision", "saved_at", "actor", "action", "origin")})
        records[-1]["field_changes"] = sum(r["kind"] == "fields" for r in differences)
        records[-1]["group_changes"] = sum(r["kind"] == "groups" for r in differences)
    records.reverse()
    return {
        "records": records[offset : offset + limit],
        "total": len(records),
        "offset": offset,
        "next_offset": offset + limit if offset + limit < len(records) else None,
        "previous_offset": max(0, offset - limit) if offset else None,
        "current_revision": policy["revision"],
        "retained_from_revision": policy["versions"][0]["revision"],
        "read_only": True,
        "history_complete": False,
    }


def compare(policy: dict[str, Any], before_revision: int, after_revision: int) -> dict[str, Any]:
    if (
        type(before_revision) is not int
        or type(after_revision) is not int
        or min(before_revision, after_revision) < 0
    ):
        raise AccessError("invalid_fields")
    by_id = {v["revision"]: v for v in policy["versions"]}
    if before_revision not in by_id or after_revision not in by_id:
        raise AccessError("policy_version_not_found")
    a, b = by_id[before_revision], by_id[after_revision]
    changes = rows(a["values"], b["values"])
    return {
        "before_revision": before_revision,
        "after_revision": after_revision,
        "rows": changes,
        "summary": {
            "fields": sum(r["kind"] == "fields" for r in changes),
            "groups": sum(r["kind"] == "groups" for r in changes),
        },
        "read_only": True,
        "physical_result": "not_verified",
    }
