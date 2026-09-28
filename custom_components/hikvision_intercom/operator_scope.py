"""Explicit person projections and request guards for restricted panel operators."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from .access.models import AccessError
from .panel_permissions import FIELDS, field_allowed, profile_field_allowed

WRITE_FIELDS = {
    "phone": "phone",
    "photo": "photo",
    "pin": "credentials",
    "cards": "credentials",
    "profile": "profile",
    "active": "access",
    "user_type": "access",
    "valid_from": "access",
    "valid_until": "access",
    "group_ids": "access",
    "assignments": "access",
    "door_permissions": "access",
    "permission_overrides": "access",
    "access_timing_draft": "access",
    "access_timing_policy": "access",
    "access_category": "access",
    "responsible_person": "access",
    "access_purpose": "access",
}


def restricted(policy: dict[str, Any]) -> bool:
    return (
        any(level != "manage" for level in policy.get("profile_fields", {}).values())
        or policy.get("station_ids") is not None
        or any(not field_allowed(policy, field, "manage") for field in FIELDS)
    )


def contains_station(policy: dict[str, Any], station_id: str) -> bool:
    allowed = policy.get("station_ids")
    return allowed is None or station_id in allowed


def visible_person(policy: dict[str, Any], person: dict[str, Any]) -> bool:
    allowed = policy.get("station_ids")
    return allowed is None or bool(set(person.get("assignments", {})) & set(allowed))


def editable_person(policy: dict[str, Any], person: dict[str, Any]) -> bool:
    allowed = policy.get("station_ids")
    return allowed is None or bool(
        person.get("assignments") and set(person["assignments"]) <= set(allowed)
    )


def project_person(
    policy: dict[str, Any],
    person: dict[str, Any],
    *,
    shared_identity_ids: frozenset[str] = frozenset(),
) -> dict[str, Any]:
    result = deepcopy(person)
    if not restricted(policy):
        return result
    result["operator_editable"] = (
        editable_person(policy, person) and person.get("id") not in shared_identity_ids
    )
    result["redacted_fields"] = [field for field in FIELDS if not field_allowed(policy, field)]
    if policy.get("station_ids") is not None and not result["operator_editable"]:
        # Shared identities are read-only; do not expose membership in global groups.
        result["group_ids"] = []
    for key in ("assignments", "permission_overrides", "timing_readbacks"):
        if isinstance(result.get(key), dict):
            result[key] = {
                sid: item for sid, item in result[key].items() if contains_station(policy, sid)
            }
    timing = result.get("access_timing_policy")
    if isinstance(timing, dict) and isinstance(timing.get("bindings"), dict):
        timing["bindings"] = {
            sid: item for sid, item in timing["bindings"].items() if contains_station(policy, sid)
        }
    if not field_allowed(policy, "phone"):
        result["phone"] = ""
    if not field_allowed(policy, "photo"):
        result["photo_configured"] = False
    if not field_allowed(policy, "credentials"):
        result["cards"], result["pin_configured"] = [], False
    if not field_allowed(policy, "profile"):
        result["profile"] = {}
    else:
        result["profile"] = {
            key: value
            for key, value in result.get("profile", {}).items()
            if profile_field_allowed(policy, key)
        }
    if not field_allowed(policy, "access"):
        result.update(
            assignments={},
            permission_overrides={},
            timing_readbacks={},
            group_ids=[],
            valid_from=None,
            valid_until=None,
            access_timing_draft=None,
            access_timing_policy=None,
            responsible_person="",
            access_purpose="",
            access_category="staff",
            user_type="normal",
        )
    return result


def project_people(
    policy: dict[str, Any],
    people: list[dict[str, Any]],
    *,
    shared_identity_ids: frozenset[str] = frozenset(),
) -> list[dict[str, Any]]:
    return [
        project_person(policy, person, shared_identity_ids=shared_identity_ids)
        for person in people
        if visible_person(policy, person)
    ]


def project_profiles(policy: dict[str, Any], value: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(value)
    if not restricted(policy):
        return result
    result["templates"] = []
    if not field_allowed(policy, "profile"):
        result["fields"] = []
    else:
        result["fields"] = [
            field
            for field in result.get("fields", [])
            if profile_field_allowed(policy, field["id"])
        ]
    if not field_allowed(policy, "photo"):
        result["photo_enabled"] = False
    if not field_allowed(policy, "access"):
        result["groups"] = []
    elif policy.get("station_ids") is not None:
        # A global group cannot be selected if it also grants another station.
        result["groups"] = [
            item
            for item in result.get("groups", [])
            if item.get("station_ids")
            and all(contains_station(policy, sid) for sid in item["station_ids"])
        ]
    return result


def project_overview(
    policy: dict[str, Any],
    value: dict[str, Any],
    *,
    shared_identity_ids: frozenset[str] = frozenset(),
) -> dict[str, Any]:
    if not restricted(policy):
        return value
    result = deepcopy(value)
    result["stations"] = [
        station for station in result["stations"] if contains_station(policy, station["id"])
    ]
    for station in result["stations"]:
        if station.get("last_access"):
            station["last_access"] = project_event(policy, station["last_access"])
    result["users"] = project_people(
        policy, result["users"], shared_identity_ids=shared_identity_ids
    )
    result["user_count"] = len(result["users"])
    if result.get("profile_settings") is not None:
        result["profile_settings"] = project_profiles(policy, result["profile_settings"])
    # These global queues include deleted people and opaque per-fleet counters.
    # Restricted operators use only the scoped person and station status rows.
    for key in ("tombstones", "revocations", "card_removals", "pin_removals"):
        result[key] = []
    result["sync_operations"] = []
    return result


def guard_fields(policy: dict[str, Any], patch: dict[str, Any]) -> None:
    if isinstance(patch.get("profile"), dict) and any(
        not profile_field_allowed(policy, key, "manage") for key in patch["profile"]
    ):
        raise AccessError("field_access_denied")
    if any(
        key in patch and not field_allowed(policy, field, "manage")
        for key, field in WRITE_FIELDS.items()
    ):
        raise AccessError("field_access_denied")


def guard_person(policy: dict[str, Any], person: dict[str, Any], *, mutate: bool = False) -> None:
    if not visible_person(policy, person):
        raise AccessError("unauthorized")
    if mutate and not editable_person(policy, person):
        raise AccessError("person_scope_shared")


def project_event(policy: dict[str, Any], record: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(record)
    if not field_allowed(policy, "photo"):
        result["portrait"] = None
    if not field_allowed(policy, "credentials"):
        result["card"] = None
    return result
