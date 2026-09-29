"""Strict account bindings; the authenticated portal authorizes each caller separately."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from .models import AccessError, text_field


def defaults() -> dict[str, Any]:
    return {"schema": 1, "revision": 0, "bindings": {}}


def checked(raw: Any) -> dict[str, Any]:
    try:
        if not isinstance(raw, dict) or set(raw) != {"schema", "revision", "bindings"}:
            raise ValueError
        if (
            type(raw["schema"]) is not int
            or raw["schema"] != 1
            or type(raw["revision"]) is not int
            or raw["revision"] < 0
        ):
            raise ValueError
        if not isinstance(raw["bindings"], dict) or len(raw["bindings"]) > 10000:
            raise ValueError
        people: set[str] = set()
        for actor, item in raw["bindings"].items():
            if text_field(actor, 128) != actor:
                raise ValueError
            if not isinstance(item, dict) or set(item) != {"user_id", "generation"}:
                raise ValueError
            if text_field(item["user_id"], 128) != item["user_id"]:
                raise ValueError
            if (
                item["user_id"] in people
                or type(item["generation"]) is not int
                or not 1 <= item["generation"] <= raw["revision"]
            ):
                raise ValueError
            people.add(item["user_id"])
    except (ValueError, TypeError, AccessError):
        raise AccessError("invalid_storage") from None
    return deepcopy(raw)


def plan_binding(
    raw: dict[str, Any], expected_revision: int, actor: str, user_id: str | None
) -> dict[str, Any]:
    """Prepare a CAS update. Only a separately authorized administrator may save it."""
    value = checked(raw)
    if type(expected_revision) is not int or value["revision"] != expected_revision:
        raise AccessError("revision_conflict")
    if text_field(actor, 128) != actor:
        raise AccessError("invalid_fields")
    if user_id is not None:
        if text_field(user_id, 128) != user_id:
            raise AccessError("invalid_fields")
        if any(
            key != actor and row["user_id"] == user_id for key, row in value["bindings"].items()
        ):
            raise AccessError("renewal_identity_in_use")
        if value["bindings"].get(actor, {}).get("user_id") == user_id:
            return value
    elif actor not in value["bindings"]:
        return value
    value["revision"] += 1
    if user_id is None:
        value["bindings"].pop(actor, None)
    else:
        value["bindings"][actor] = {"user_id": user_id, "generation": value["revision"]}
    return checked(value)


def resolve(raw: dict[str, Any], authenticated_actor: str) -> dict[str, Any]:
    """Return one binding. The actor must come from a verified server principal."""
    value = checked(raw)
    text_field(authenticated_actor, 128)
    item = value["bindings"].get(authenticated_actor)
    if not item:
        raise AccessError("renewal_identity_unlinked")
    return {"actor": authenticated_actor, **item}


def recheck(raw: dict[str, Any], captured: dict[str, Any]) -> None:
    """Removing/replacing and even relinking the same account invalidates old requests."""
    if (
        not isinstance(captured, dict)
        or set(captured) != {"actor", "user_id", "generation"}
        or type(captured.get("generation")) is not int
    ):
        raise AccessError("renewal_identity_changed")
    try:
        current = resolve(raw, captured["actor"])
    except AccessError:
        raise AccessError("renewal_identity_changed") from None
    if current != captured:
        raise AccessError("renewal_identity_changed")
