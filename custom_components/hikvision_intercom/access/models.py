"""Private central records and an explicit, masked administrator projection."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from ..client.access import validate_card, validate_identifier
from ..exceptions import HikvisionValidationError

SYNC_STATES = frozenset(
    {"synced", "pending", "syncing", "offline", "conflict", "error", "delete_pending"}
)


class AccessError(Exception):
    """Stable public error key; never format a record or credential into the exception."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def uuid_text(value: Any) -> str:
    try:
        if not isinstance(value, str) or str(UUID(value)) != value:
            raise ValueError
    except (ValueError, AttributeError):
        raise AccessError("invalid_id") from None
    return value


def text_field(value: Any, maximum: int, *, empty: bool = False) -> str:
    if (
        not isinstance(value, str)
        or len(value) > maximum
        or (not empty and not value.strip())
        or any(ord(c) < 32 for c in value)
    ):
        raise AccessError("invalid_text")
    return value.strip()


def boolean(value: Any) -> bool:
    if type(value) is not bool:
        raise AccessError("invalid_boolean")
    return value


def valid_period(start: Any, end: Any) -> tuple[str | None, str | None]:
    if start is None and end is None:
        return None, None
    try:
        if not isinstance(start, str) or not isinstance(end, str):
            raise ValueError
        first, last = datetime.fromisoformat(start), datetime.fromisoformat(end)
        if first.tzinfo is None or last.tzinfo is None:
            raise ValueError
        first, last = first.astimezone(UTC), last.astimezone(UTC)
        if (
            not datetime(1970, 1, 1, tzinfo=UTC)
            <= first
            < last
            <= datetime(2037, 12, 31, 23, 59, 59, tzinfo=UTC)
        ):
            raise ValueError
    except (ValueError, OverflowError):
        raise AccessError("invalid_validity") from None
    return first.isoformat(timespec="seconds"), last.isoformat(timespec="seconds")


@dataclass(frozen=True, slots=True)
class SecretValue:
    value: str = field(repr=False)

    def __str__(self) -> str:
        return "REDACTED"


@dataclass(slots=True, repr=False)
class ManagedCard:
    id: str
    card_no: SecretValue
    label: str = ""
    card_type: str = "normalCard"
    enabled: bool = True

    def private(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "card_no": self.card_no.value,
            "label": self.label,
            "card_type": self.card_type,
            "enabled": self.enabled,
        }

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "masked_number": "•••• " + self.card_no.value[-4:]
            if len(self.card_no.value) > 4
            else "••••",
            "label": self.label,
            "card_type": self.card_type,
            "enabled": self.enabled,
        }


@dataclass(slots=True)
class StationAssignment:
    config_entry_id: str
    enabled: bool
    allowed_locks: frozenset[int]
    schedule_template: str | None = None
    desired_revision: int = 1
    applied_revision: int | None = None
    sync_state: str = "pending"
    last_sync_at: str | None = None
    last_error: str | None = None

    def serialize(self) -> dict[str, Any]:
        return {
            "config_entry_id": self.config_entry_id,
            "enabled": self.enabled,
            "allowed_locks": sorted(self.allowed_locks),
            "schedule_template": self.schedule_template,
            "desired_revision": self.desired_revision,
            "applied_revision": self.applied_revision,
            "sync_state": self.sync_state,
            "last_sync_at": self.last_sync_at,
            "last_error": self.last_error,
        }


@dataclass(slots=True, repr=False)
class ManagedUser:
    id: str
    employee_no: str
    display_name: str
    active: bool
    user_type: str
    valid_from: str | None
    valid_until: str | None
    pin: SecretValue | None
    cards: list[ManagedCard]
    assignments: dict[str, StationAssignment]
    revision: int
    created_at: str
    updated_at: str
    identity_locked: bool = False
    profile: dict[str, str] = field(default_factory=dict)
    group_ids: list[str] = field(default_factory=list)
    photo: str | None = field(default=None, repr=False)

    def private(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "employee_no": self.employee_no,
            "display_name": self.display_name,
            "active": self.active,
            "user_type": self.user_type,
            "valid_from": self.valid_from,
            "valid_until": self.valid_until,
            "pin": self.pin.value if self.pin else None,
            "cards": [card.private() for card in self.cards],
            "assignments": {
                key: assignment.serialize() for key, assignment in self.assignments.items()
            },
            "revision": self.revision,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "identity_locked": self.identity_locked,
            "profile": dict(self.profile),
            "group_ids": list(self.group_ids),
            "photo": self.photo,
        }

    def public(self) -> dict[str, Any]:
        data = {
            key: value
            for key, value in self.private().items()
            if key not in {"pin", "cards", "photo"}
        }
        data["photo_configured"] = self.photo is not None
        data["pin_configured"] = self.pin is not None
        data["cards"] = [card.public() for card in self.cards]
        return data

    @classmethod
    def from_private(cls, data: dict[str, Any]) -> ManagedUser:
        # Persisted records are validated too; malformed storage must fail closed.
        try:
            user = build_user(data, employee_no=data["employee_no"], now=data["created_at"])
            user.id = uuid_text(data["id"])
            revision = data["revision"]
            if type(revision) is not int or revision < 1:
                raise AccessError("invalid_storage")
            user.revision, user.updated_at = revision, text_field(data["updated_at"], 40)
            user.identity_locked = boolean(data.get("identity_locked", False))
            for key, assignment in user.assignments.items():
                saved = data["assignments"][key]
                desired, applied = saved["desired_revision"], saved.get("applied_revision")
                if (
                    type(desired) is not int
                    or desired < 1
                    or (
                        applied is not None
                        and (type(applied) is not int or not 1 <= applied <= desired)
                    )
                ):
                    raise AccessError("invalid_storage")
                assignment.desired_revision, assignment.applied_revision = desired, applied
                state = saved.get("sync_state", "pending")
                if state not in SYNC_STATES:
                    raise AccessError("invalid_storage")
                assignment.sync_state = state
                assignment.last_sync_at = saved.get("last_sync_at")
                assignment.last_error = saved.get("last_error")
            return user
        except (KeyError, TypeError, AttributeError, HikvisionValidationError):
            raise AccessError("invalid_storage") from None


def build_user(
    data: dict[str, Any], *, employee_no: str, now: str, previous: ManagedUser | None = None
) -> ManagedUser:
    """Patch desired state; absent PIN/card numbers keep existing secret material."""
    from ..profile_settings import group_values, photo_value, profile_values

    try:
        employee_no = validate_identifier(data.get("employee_no", employee_no))
        name = text_field(data.get("display_name", previous.display_name if previous else ""), 32)
        active = boolean(data.get("active", previous.active if previous else True))
        user_type = data.get("user_type", previous.user_type if previous else "normal")
        if user_type != "normal":
            raise AccessError("unsupported_user_type")
        start, end = valid_period(
            data.get("valid_from", previous.valid_from if previous else None),
            data.get("valid_until", previous.valid_until if previous else None),
        )
        pin = data.get("pin", previous.pin.value if previous and previous.pin else None)
        if pin is not None and (not isinstance(pin, str) or not re.fullmatch(r"[0-9]{1,128}", pin)):
            raise AccessError("invalid_pin")
        old_cards = {card.id: card for card in previous.cards} if previous else {}
        raw_cards = data.get(
            "cards", [card.private() for card in previous.cards] if previous else []
        )
        if not isinstance(raw_cards, list) or len(raw_cards) > 255:
            raise AccessError("invalid_cards")
        cards: list[ManagedCard] = []
        for raw in raw_cards:
            if not isinstance(raw, dict):
                raise AccessError("invalid_cards")
            card_id = uuid_text(raw["id"]) if "id" in raw else str(uuid4())
            old = old_cards.get(card_id)
            number = validate_card(raw.get("card_no", old.card_no.value if old else None))
            card_type = raw.get("card_type", old.card_type if old else "normalCard")
            if card_type != "normalCard":
                raise AccessError("unsupported_card_type")
            cards.append(
                ManagedCard(
                    card_id,
                    SecretValue(number),
                    text_field(raw.get("label", old.label if old else ""), 64, empty=True),
                    card_type,
                    boolean(raw.get("enabled", old.enabled if old else True)),
                )
            )
        if len({card.id for card in cards}) != len(cards) or len(
            {card.card_no.value for card in cards}
        ) != len(cards):
            raise AccessError("duplicate_card")
        raw_assignments = data.get(
            "assignments",
            {key: item.serialize() for key, item in previous.assignments.items()}
            if previous
            else {},
        )
        if not isinstance(raw_assignments, dict) or len(raw_assignments) > 100:
            raise AccessError("invalid_assignments")
        revision = previous.revision + 1 if previous else 1
        assignments = {}
        for station_id, raw in raw_assignments.items():
            station_id = text_field(station_id, 64)
            if not isinstance(raw, dict):
                raise AccessError("invalid_assignments")
            enabled = boolean(raw.get("enabled", True))
            locks = raw.get("allowed_locks", [1])
            if (
                not isinstance(locks, list)
                or any(type(lock) is not int or lock != 1 for lock in locks)
                or len(locks) != len(set(locks))
            ):
                raise AccessError("unmanaged_lock")
            if enabled and locks != [1]:
                raise AccessError("unmanaged_lock")
            if raw.get("schedule_template") is not None:
                raise AccessError("schedule_unverified")
            old_assignment = previous.assignments.get(station_id) if previous else None
            assignments[station_id] = StationAssignment(
                station_id,
                enabled,
                frozenset(locks),
                desired_revision=revision,
                applied_revision=old_assignment.applied_revision if old_assignment else None,
            )
        return ManagedUser(
            previous.id if previous else str(uuid4()),
            employee_no,
            name,
            active,
            user_type,
            start,
            end,
            SecretValue(pin) if pin is not None else None,
            cards,
            assignments,
            revision,
            previous.created_at if previous else now,
            now,
            previous.identity_locked if previous else False,
            profile_values(data.get("profile", previous.profile if previous else {})),
            group_values(data.get("group_ids", previous.group_ids if previous else [])),
            photo_value(data.get("photo", previous.photo if previous else None)),
        )
    except HikvisionValidationError:
        raise AccessError("invalid_identifier") from None
