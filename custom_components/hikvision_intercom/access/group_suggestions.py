"""Read-only group suggestions from visible, applicable profile evidence."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from ..profile_conditions import resolve_applicability
from ..profile_settings import profile_issue
from .models import AccessError


def suggest(
    people: list[dict[str, Any]],
    policy: dict[str, Any],
    stations: list[dict[str, Any]],
    *,
    user_id: str,
    field_ids: list[str],
) -> dict[str, Any]:
    if (
        not isinstance(user_id, str)
        or not isinstance(field_ids, list)
        or len(field_ids) > 3
        or any(not isinstance(f, str) for f in field_ids)
        or len(set(field_ids)) != len(field_ids)
    ):
        raise AccessError("invalid_fields")
    target = next((p for p in people if p["id"] == user_id), None)
    if target is None:
        raise AccessError("comparison_not_found")
    # Unknown ancestors are not re-evaluated from redacted values. Remove their
    # descendants from the evidence graph as well, rather than guessing applicability.
    definitions = {f["id"]: f for f in policy.get("fields", [])}
    opaque = {f["id"] for f in definitions.values() if f.get("applicability_unknown")}
    changed = True
    while changed:
        before = set(opaque)
        opaque.update(
            f["id"]
            for f in definitions.values()
            if (f.get("depends_on") or {}).get("field_id") in opaque
            or (
                (f.get("depends_on") or {}).get("field_id") is not None
                and f["depends_on"]["field_id"] not in definitions
            )
        )
        changed = opaque != before
    fields = [f for f in definitions.values() if f["id"] not in opaque]
    target_values = target.get("profile", {})
    target_applies = resolve_applicability(fields, target_values)
    available = [
        f
        for f in fields
        if f["enabled"]
        and not f.get("unique")
        and f.get("type", "text") in {"text", "select"}
        and target_applies[f["id"]]
        and target_values.get(f["id"], "").strip()
        and not profile_issue(f, target_values[f["id"]])
    ]
    allowed_ids = {f["id"] for f in available}
    if any(key not in allowed_ids for key in field_ids):
        raise AccessError("field_access_denied")
    groups = [
        g
        for g in policy.get("groups", [])
        if g["enabled"] and g.get("station_ids") and g["id"] not in target.get("group_ids", [])
    ]
    donors = []
    if field_ids:
        for person in people:
            if (
                person["id"] == target["id"]
                or person.get("active") is not True
                or person.get("archived_at")
            ):
                continue
            # Shared identities do not expose global memberships to scoped operators.
            if person.get("operator_editable") is False:
                continue
            values = person.get("profile", {})
            applies = resolve_applicability(fields, values)
            if all(applies.get(key) and values.get(key) == target_values[key] for key in field_ids):
                donors.append(person)
    names = {s["id"]: s["name"] for s in stations}
    suggestions = []
    for group in groups:
        count = sum(group["id"] in p.get("group_ids", []) for p in donors)
        if not count:
            continue
        doors = []
        for sid in group["station_ids"]:
            if sid not in names:
                continue
            assignment = target.get("assignments", {}).get(sid, {})
            override = target.get("permission_overrides", {}).get(sid)
            # Preserve explicit blocks and existing relay mappings. New inheritance
            # supplies physical lock 1, matching the existing group permission path.
            locks = assignment.get("allowed_locks", []) if assignment.get("enabled") else []
            doors.append(
                {
                    "station_id": sid,
                    "station_name": names[sid],
                    "blocked": override == "deny",
                    "before": locks,
                    "after": locks if locks or override == "deny" else [1],
                }
            )
        if not doors:
            continue
        suggestions.append(
            {
                "group_id": group["id"],
                "label": group["label"],
                "matching_members": count,
                "matching_people": len(donors),
                "doors": doors,
            }
        )
    suggestions.sort(key=lambda s: (-s["matching_members"], s["label"].casefold(), s["group_id"]))
    result = {
        "user_id": user_id,
        "person_revision": target["revision"],
        "policy_revision": policy["revision"],
        "fields": [
            {"id": f["id"], "label": f["label"], "value": target_values[f["id"]]} for f in available
        ],
        "selected_fields": field_ids,
        "suggestions": suggestions,
        "read_only": True,
        "scope": "caller_projected",
        "can_apply_to_draft": target.get("operator_editable") is not False
        and not target.get("archived_at"),
        "physical_result": "not_verified",
    }
    result["fingerprint"] = hashlib.sha256(
        json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()
    return result
