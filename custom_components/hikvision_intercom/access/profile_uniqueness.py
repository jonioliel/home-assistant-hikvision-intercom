"""Selected metadata uniqueness is checked atomically across retained identities."""

from __future__ import annotations

import unicodedata
from decimal import Decimal, InvalidOperation
from typing import Any

from ..profile_settings import profile_issue
from .models import AccessError


def canonical(field: dict[str, Any], value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).strip().casefold()
    if field.get("type") == "number" and normalized and profile_issue(field, value) is None:
        try:
            number = Decimal(normalized)
            if number.is_finite():
                return "0" if number.is_zero() else str(number.normalize())
        except InvalidOperation:
            pass
    return normalized


def collisions(
    policy: dict[str, Any] | None, records: list[dict[str, Any]]
) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    for field in (policy or {}).get("values", {}).get("fields", []):
        if not field["enabled"] or not field.get("unique", False):
            continue
        owners: dict[str, list[dict[str, Any]]] = {}
        for record in records:
            key = canonical(field, record.get("profile", {}).get(field["id"], ""))
            if key:
                owners.setdefault(key, []).append(record)
        result[field["id"]] = [
            record for group in owners.values() if len(group) > 1 for record in group
        ]
    return result


def validate(policy: dict[str, Any] | None, records: list[dict[str, Any]]) -> None:
    if any(collisions(policy, records).values()):
        # Never identify another owner or expose their value to a restricted caller.
        raise AccessError("profile_value_not_unique")
