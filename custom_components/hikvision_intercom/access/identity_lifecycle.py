"""Privacy-safe identity lifecycle insights and duplicate candidates."""

from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Any

from .models import AccessError, ManagedUser, phone_value, text_field

MAX_ROWS = 200
MAX_WARNING_DAYS = 365


def _instant(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            raise ValueError
        return parsed.astimezone(UTC)
    except (TypeError, ValueError, OverflowError):
        raise AccessError("invalid_validity") from None


def _name_key(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def _phone_key(value: str) -> str:
    return re.sub(r"\D", "", value)


def _user_row(user: ManagedUser) -> dict[str, Any]:
    enabled_cards = sum(card.enabled for card in user.cards)
    assignments = sum(item.enabled for item in user.assignments.values())
    return {
        "id": user.id,
        "display_name": user.display_name,
        "employee_no": user.employee_no,
        "phone": user.phone,
        "active": user.active,
        "valid_from": user.valid_from,
        "valid_until": user.valid_until,
        "pin_configured": user.pin is not None,
        "card_count": len(user.cards),
        "enabled_card_count": enabled_cards,
        "assignment_count": assignments,
        "group_ids": list(user.group_ids),
    }


def _bounded(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], bool]:
    return rows[:MAX_ROWS], len(rows) > MAX_ROWS


def report(
    users: Iterable[ManagedUser], *, warning_days: int = 30, now: datetime | None = None
) -> dict[str, Any]:
    """Build a bounded projection without PIN or complete card values."""

    if type(warning_days) is not int or not 1 <= warning_days <= MAX_WARNING_DAYS:
        raise AccessError("invalid_fields")
    current = (now or datetime.now(UTC)).astimezone(UTC)
    records = list(users)
    rows = {user.id: _user_row(user) for user in records}
    expirations: list[dict[str, Any]] = []
    missing_credentials: list[dict[str, Any]] = []
    scheduled = 0
    expired = 0
    expiring = 0

    indexes: dict[str, dict[str, set[str]]] = {
        "display_name": defaultdict(set),
        "phone": defaultdict(set),
        "card_last4": defaultdict(set),
    }
    for user in records:
        name = _name_key(user.display_name)
        if len(name) >= 2:
            indexes["display_name"][name].add(user.id)
        phone = _phone_key(user.phone)
        if phone:
            indexes["phone"][phone].add(user.id)
        for card in user.cards:
            if card.enabled and len(card.card_no.value) >= 4:
                indexes["card_last4"][card.card_no.value[-4:]].add(user.id)
        if user.active and user.pin is None and not any(card.enabled for card in user.cards):
            missing_credentials.append(rows[user.id])
        if user.valid_from and _instant(user.valid_from) > current:
            scheduled += 1
        if not user.valid_until:
            continue
        end = _instant(user.valid_until)
        remaining = end - current
        if remaining.total_seconds() < 0:
            state = "expired"
            expired += 1
        elif remaining <= timedelta(days=warning_days):
            state = "expiring"
            expiring += 1
        else:
            continue
        expirations.append(
            {
                **rows[user.id],
                "state": state,
                "seconds_remaining": int(remaining.total_seconds()),
            }
        )

    duplicates: list[dict[str, Any]] = []
    affected: set[str] = set()
    for reason, values in indexes.items():
        for value, identifiers in values.items():
            if len(identifiers) < 2:
                continue
            ordered = sorted(identifiers, key=lambda item: (rows[item]["display_name"], item))
            affected.update(ordered)
            duplicates.append(
                {
                    "reason": reason,
                    "match": f"•••• {value}" if reason == "card_last4" else None,
                    "users": [rows[item] for item in ordered],
                }
            )
    duplicates.sort(
        key=lambda item: (item["reason"], item.get("match") or "", item["users"][0]["display_name"])
    )
    expirations.sort(key=lambda item: (item["valid_until"] or "", item["display_name"]))
    missing_credentials.sort(key=lambda item: (item["display_name"], item["id"]))
    duplicates_page, duplicate_truncated = _bounded(duplicates)
    expiry_page, expiry_truncated = _bounded(expirations)
    credentials_page, credentials_truncated = _bounded(missing_credentials)
    return {
        "format": "hikvision_intercom.identity_lifecycle",
        "generated_at": current.isoformat(timespec="seconds"),
        "warning_days": warning_days,
        "summary": {
            "total": len(records),
            "active": sum(user.active for user in records),
            "scheduled": scheduled,
            "expired": expired,
            "expiring": expiring,
            "without_credentials": len(missing_credentials),
            "duplicate_groups": len(duplicates),
            "duplicate_users": len(affected),
        },
        "expirations": expiry_page,
        "duplicates": duplicates_page,
        "without_credentials": credentials_page,
        "truncated": {
            "expirations": expiry_truncated,
            "duplicates": duplicate_truncated,
            "without_credentials": credentials_truncated,
        },
        "privacy": "no_pin_or_complete_card_values",
    }


def candidate_matches(
    users: Iterable[ManagedUser], data: dict[str, Any], *, exclude_user_id: str = ""
) -> dict[str, Any]:
    """Return potential existing-user matches for a save preview."""

    if not isinstance(data, dict) or set(data) - {
        "employee_no",
        "display_name",
        "phone",
        "card_suffixes",
    }:
        raise AccessError("invalid_fields")
    employee = text_field(data.get("employee_no", ""), 32, empty=True)
    display_name = text_field(data.get("display_name", ""), 64, empty=True)
    raw_phone = data.get("phone", "")
    phone = phone_value(raw_phone) if raw_phone else ""
    suffixes = data.get("card_suffixes", [])
    if (
        not isinstance(suffixes, list)
        or len(suffixes) > 255
        or any(
            not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}", value) for value in suffixes
        )
    ):
        raise AccessError("invalid_fields")
    suffix_set = set(suffixes)
    name_key, phone_key = _name_key(display_name), _phone_key(phone)
    matches: list[dict[str, Any]] = []
    for user in users:
        if user.id == exclude_user_id:
            continue
        reasons: list[str] = []
        card_matches = sorted(
            {
                card.card_no.value[-4:]
                for card in user.cards
                if card.enabled
                and len(card.card_no.value) >= 4
                and card.card_no.value[-4:] in suffix_set
            }
        )
        if employee and user.employee_no == employee:
            reasons.append("employee_no")
        if len(name_key) >= 2 and _name_key(user.display_name) == name_key:
            reasons.append("display_name")
        if phone_key and _phone_key(user.phone) == phone_key:
            reasons.append("phone")
        if card_matches:
            reasons.append("card_last4")
        if reasons:
            matches.append(
                {
                    **_user_row(user),
                    "reasons": reasons,
                    "card_matches": [f"•••• {value}" for value in card_matches],
                }
            )
    matches.sort(key=lambda item: (item["display_name"], item["id"]))
    page, truncated = _bounded(matches)
    return {
        "matches": page,
        "total": len(matches),
        "truncated": truncated,
        "blocking": any("employee_no" in item["reasons"] for item in matches),
        "privacy": "no_pin_or_complete_card_values",
    }
