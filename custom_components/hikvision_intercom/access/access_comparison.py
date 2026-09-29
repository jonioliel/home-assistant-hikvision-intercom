"""Read-only differences of caller-projected people and group grants; no credential copying."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from .models import AccessError

KINDS = {"person", "group"}


def operand(
    kind: str, identifier: str, people: list[dict[str, Any]], groups: list[dict[str, Any]]
) -> dict[str, Any]:
    if kind not in KINDS or not isinstance(identifier, str) or not identifier:
        raise AccessError("invalid_fields")
    source = people if kind == "person" else groups
    match = next((row for row in source if row["id"] == identifier), None)
    if match is None:
        raise AccessError("comparison_not_found")
    return match


def side(
    kind: str, value: dict[str, Any], groups: list[dict[str, Any]], station: str, lock: int
) -> dict[str, Any]:
    if kind == "group":
        configured = station in value.get("station_ids", []) and lock == 1
        return {
            "granted": bool(value.get("enabled") and configured),
            "configured": configured,
            "source": "group_policy",
            "groups": [],
            "override": None,
            "sources_known": True,
        }
    assignment = value.get("assignments", {}).get(station, {})
    personal = value.get("permission_overrides", {}).get(station)
    inherited = [
        g
        for g in groups
        if g.get("enabled")
        and g["id"] in value.get("group_ids", [])
        and station in g.get("station_ids", [])
    ]
    known = value.get("operator_editable") is not False
    granted = assignment.get("enabled") is True and lock in assignment.get("allowed_locks", [])
    source = (
        "personal_deny"
        if personal == "deny"
        else "personal_allow"
        if personal == "allow"
        else "inherited"
        if inherited
        else "restricted"
        if not known
        else "assignment"
        if assignment
        else "none"
    )
    return {
        "granted": granted,
        "configured": lock in assignment.get("allowed_locks", []),
        "source": source,
        "groups": [{"id": g["id"], "name": g["label"]} for g in inherited],
        "override": personal,
        "sources_known": known,
    }


def compare(
    people: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    stations: list[dict[str, Any]],
    *,
    left_kind: str,
    left_id: str,
    right_kind: str,
    right_id: str,
) -> dict[str, Any]:
    left = operand(left_kind, left_id, people, groups)
    right = operand(right_kind, right_id, people, groups)
    rows: list[dict[str, Any]] = []
    summary = {"shared": 0, "left_only": 0, "right_only": 0, "neither": 0}
    for station in stations:
        sid = station["id"]
        # Group policy supplies the existing default physical lock 1 only. It is
        # never inferred to supply relay 2; explicit person door mappings remain distinct.
        for lock in (1, 2):
            a, b = (
                side(left_kind, left, groups, sid, lock),
                side(right_kind, right, groups, sid, lock),
            )
            configured = any(
                (v.get("assignments", {}).get(sid) or sid in v.get("station_ids", []))
                for v in (left, right)
            )
            if not configured or lock == 2 and not (a["configured"] or b["configured"]):
                continue
            relation = (
                "shared"
                if a["granted"] and b["granted"]
                else "left_only"
                if a["granted"]
                else "right_only"
                if b["granted"]
                else "neither"
            )
            summary[relation] += 1
            rows.append(
                {
                    "station_id": sid,
                    "station_name": station["name"],
                    "lock_id": lock,
                    "relation": relation,
                    "left": a,
                    "right": b,
                }
            )
    rows.sort(key=lambda r: (r["station_name"].casefold(), r["station_id"], r["lock_id"]))

    def label(kind: str, value: dict[str, Any]) -> dict[str, Any]:
        result = {
            "kind": kind,
            "id": value["id"],
            "name": value.get("display_name", value.get("label", "")),
        }
        if kind == "person":
            result.update(
                active=value.get("active") is True,
                archived=bool(value.get("archived_at")),
                valid_from=value.get("valid_from"),
                valid_until=value.get("valid_until"),
                timing_mode=(value.get("access_timing_policy") or {}).get("mode", "unrestricted"),
            )
        else:
            result["enabled"] = value.get("enabled") is True
        return result

    return {
        "left": label(left_kind, left),
        "right": label(right_kind, right),
        "rows": rows,
        "summary": summary,
        "read_only": True,
        "scope": "caller_projected",
        "physical_result": "not_verified",
    }


def options(
    people: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    *,
    kind: str,
    query: str = "",
    offset: int = 0,
    limit: int = 25,
) -> dict[str, Any]:
    if (
        kind not in KINDS
        or not isinstance(query, str)
        or len(query) > 128
        or type(offset) is not int
        or offset < 0
        or type(limit) is not int
        or not 1 <= limit <= 100
    ):
        raise AccessError("invalid_fields")
    values = [
        {
            "id": v["id"],
            "name": v.get("display_name", v.get("label", "")),
            "archived": bool(v.get("archived_at")),
        }
        for v in (people if kind == "person" else groups)
    ]
    values = [v for v in values if query.strip().casefold() in v["name"].casefold()]
    values.sort(key=lambda v: (v["name"].casefold(), v["id"]))
    return {
        "records": deepcopy(values[offset : offset + limit]),
        "total": len(values),
        "offset": offset,
        "limit": limit,
        "next_offset": offset + limit if offset + limit < len(values) else None,
        "previous_offset": max(0, offset - limit) if offset else None,
        "read_only": True,
    }
