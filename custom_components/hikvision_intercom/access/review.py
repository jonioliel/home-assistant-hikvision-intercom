"""Read-only, secret-free comparisons of effective desired and observed access state."""

from __future__ import annotations

from typing import Any

from ..client.access import AccessCapabilities, StationInventory
from .models import ManagedCard, ManagedUser, SecretValue
from .normalize import canonical, desired_cards, desired_person


def desired_view(
    user: ManagedUser | None, station_id: str, api_id: int, caps: AccessCapabilities
) -> dict[str, Any]:
    assignment = user.assignments.get(station_id) if user else None
    if user is None or not user.active or not assignment or not assignment.enabled:
        return {"person": None, "cards": []}
    return canonical(
        StationInventory(
            {user.employee_no: desired_person(user, api_id, caps)}, desired_cards(user, caps)
        ),
        user.employee_no,
        caps,
    )


def public_view(normal: dict[str, Any], caps: AccessCapabilities) -> dict[str, Any]:
    """Allowlist display fields; never return PINs, full cards or raw device structures."""
    person = normal["person"]
    valid = person["Valid"] if person else {}
    return {
        "present": person is not None,
        "display_name": person["name"] if person else None,
        "user_type": (
            person["userType"] if person and person["userType"] in caps.user_types else None
        ),
        "validity": {
            "timed": valid.get("enable"),
            "from": valid.get("beginTime"),
            "until": valid.get("endTime"),
            "time_type": valid.get("timeType"),
        },
        "door_rights": (
            [int(item) for item in person["doorRight"].split(",")]
            if person
            and isinstance(person["doorRight"], str)
            and all(item in {"1", "2"} for item in person["doorRight"].split(","))
            else []
        ),
        "pin_configured": bool(person["pin"]) if person and caps.pin_field else None,
        "cards": [
            ManagedCard("", SecretValue(card["cardNo"]), card_type=card["cardType"]).public()
            for card in normal["cards"]
        ],
        "schedule_configured": bool(person and person["RightPlan"] != []),
        "privileged": bool(person and person["localUIRight"] is not False),
        "other_credentials": bool(person and any(person["unsupported_credentials"].values())),
    }


def compare(desired: dict[str, Any], observed: dict[str, Any]) -> dict[str, Any]:
    """Compare secrets before masking, including different cards with identical suffixes."""
    first, last = desired["person"], observed["person"]
    fields = {
        "presence": (first is not None, last is not None),
        **{
            label: (first.get(key) if first else None, last.get(key) if last else None)
            for label, key in {
                "display_name": "name",
                "user_type": "userType",
                "validity": "Valid",
                "door_rights": "doorRight",
                "pin": "pin",
                "schedule": "RightPlan",
                "privileged": "localUIRight",
                "other_credentials": "unsupported_credentials",
            }.items()
        },
        "cards": (desired["cards"], observed["cards"]),
    }
    changes = [key for key, (before, after) in fields.items() if before != after]
    old_cards = {card["cardNo"]: card for card in observed["cards"]}
    new_cards = {card["cardNo"]: card for card in desired["cards"]}
    old_pin = (last.get("pin") or None) if last else None
    new_pin = (first.get("pin") or None) if first else None
    return {
        "differences": changes,
        "plan": {
            "person": (
                "create"
                if first and not last
                else "delete"
                if last and not first
                else "update"
                if first != last
                else "none"
            ),
            "pin": (
                "none"
                if old_pin == new_pin
                else "remove"
                if not new_pin
                else "set"
                if not old_pin
                else "change"
            ),
            "cards_add": len(new_cards.keys() - old_cards.keys()),
            "cards_remove": len(old_cards.keys() - new_cards.keys()),
            "cards_update": sum(
                old_cards[number] != new_cards[number]
                for number in old_cards.keys() & new_cards.keys()
            ),
        },
    }
