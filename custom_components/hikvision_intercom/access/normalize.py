"""Compare only managed fields; secret-bearing snapshots remain private."""

from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
from typing import Any

from ..client.access import AccessCapabilities, StationInventory
from .models import AccessError, ManagedUser


def canonical(
    inventory: StationInventory, employee_no: str, caps: AccessCapabilities
) -> dict[str, Any]:
    raw = inventory.users.get(employee_no)
    person: dict[str, Any] | None = None
    if raw is not None:
        validity = raw.get("Valid")
        if not isinstance(validity, dict) or type(validity.get("enable")) is not bool:
            raise AccessError("unreadable_validity")
        valid: dict[str, Any] = {"enable": validity["enable"]}
        if valid["enable"]:
            try:
                time_type = validity["timeType"]
                first, last = (
                    datetime.fromisoformat(validity["beginTime"]),
                    datetime.fromisoformat(validity["endTime"]),
                )
                if time_type == "local" and (first.tzinfo or last.tzinfo):
                    raise AccessError("validity_timezone_mismatch")
                if time_type == "UTC" and first.tzinfo and last.tzinfo:
                    first, last = first.astimezone(UTC), last.astimezone(UTC)
                elif time_type != "local" or first.tzinfo or last.tzinfo:
                    raise ValueError
            except (KeyError, TypeError, ValueError):
                raise AccessError("unreadable_validity") from None
            valid.update(
                beginTime=first.isoformat(timespec="seconds"),
                endTime=last.isoformat(timespec="seconds"),
                timeType=time_type,
            )
        pin = raw.get(caps.pin_field, "") if caps.pin_field else None
        if pin is not None and (
            not isinstance(pin, str) or pin and (not pin.isascii() or not pin.isdecimal())
        ):
            raise AccessError("pin_readback_unavailable")
        person = {
            "employeeNo": employee_no,
            "name": raw.get("name", ""),
            "userType": raw.get("userType"),
            "Valid": valid,
            "doorRight": raw.get("doorRight"),
            "RightPlan": raw.get("RightPlan"),
            "localUIRight": raw.get("localUIRight"),
            "pin": pin,
            "unsupported_credentials": {key: raw.get(key, 0) for key in ("numOfFace", "numOfFP")},
        }
    cards = [
        {"employeeNo": card["employeeNo"], "cardNo": card["cardNo"], "cardType": card["cardType"]}
        for card in inventory.cards.values()
        if card["employeeNo"] == employee_no
    ]
    return {"person": person, "cards": sorted(cards, key=lambda card: card["cardNo"])}


def desired_person(user: ManagedUser, api_id: int, caps: AccessCapabilities) -> dict[str, Any]:
    if len(user.employee_no) > caps.employee_max or len(user.display_name) > caps.name_max:
        raise AccessError("person_exceeds_capabilities")
    if user.user_type not in caps.user_types:
        raise AccessError("unsupported_user_type")
    if user.valid_from is None:
        validity = {
            "enable": False,
            # This firmware rejects the generic 1970/2037 endpoints even when enable=False.
            # The interior interval was accepted/read back on V3.9.0; enable=False is permanent.
            "beginTime": "2000-01-01T00:00:00+00:00",
            "endTime": "2030-01-01T00:00:00+00:00",
            "timeType": "UTC",
        }
    else:
        validity = {
            "enable": True,
            "beginTime": user.valid_from,
            "endTime": user.valid_until,
            "timeType": "UTC",
        }
    person: dict[str, Any] = {
        "employeeNo": user.employee_no,
        "name": user.display_name,
        "userType": user.user_type,
        "Valid": validity,
        "doorRight": str(api_id),
        "RightPlan": [],
        "localUIRight": False,
    }
    if user.pin is not None:
        if caps.pin_field is None:
            raise AccessError("pin_device_managed")
        if not caps.pin_min <= len(user.pin.value) <= caps.pin_max:
            raise AccessError("pin_exceeds_capabilities")
    if caps.pin_field:
        person[caps.pin_field] = user.pin.value if user.pin else ""
    return person


def desired_cards(user: ManagedUser, caps: AccessCapabilities) -> dict[str, dict[str, Any]]:
    cards = {
        card.card_no.value: {
            "employeeNo": user.employee_no,
            "cardNo": card.card_no.value,
            "cardType": card.card_type,
        }
        for card in user.cards
        if card.enabled
    }
    if cards and (caps.cards_per_person == 0 or len(cards) > caps.cards_per_person):
        raise AccessError("card_capacity")
    if any(
        not caps.card_min <= len(number) <= caps.card_max or card["cardType"] not in caps.card_types
        for number, card in cards.items()
    ):
        raise AccessError("card_exceeds_capabilities")
    return cards


def person_view(inventory: StationInventory, employee_no: str) -> StationInventory:
    return StationInventory(
        {employee_no: deepcopy(inventory.users[employee_no])}
        if employee_no in inventory.users
        else {},
        {
            key: deepcopy(card)
            for key, card in inventory.cards.items()
            if card["employeeNo"] == employee_no
        },
    )


def merge_person(inventory: StationInventory, employee_no: str, observed: StationInventory) -> None:
    inventory.users.pop(employee_no, None)
    inventory.users.update(deepcopy(observed.users))
    for key, card in list(inventory.cards.items()):
        if card["employeeNo"] == employee_no:
            del inventory.cards[key]
    inventory.cards.update(deepcopy(observed.cards))
