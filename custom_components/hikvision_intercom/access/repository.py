"""Durable desired state, ownership bindings and deletion tombstones.

Every mutation is saved before being published to in-memory readers. Network work
never runs under the repository lock. Secrets only leave through private copies.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import secrets
from collections.abc import Awaitable, Callable, Mapping
from copy import deepcopy
from datetime import datetime
from typing import Any, TypeVar
from uuid import uuid4

from .admin_audit import append_changes, current_actor, validate_storage
from .models import AccessError, ManagedUser, build_user, utc_now

T = TypeVar("T")
Save = Callable[[dict[str, Any]], Awaitable[None]]


class AccessRepository:
    def __init__(self, save: Save) -> None:
        self._save = save
        self._lock = asyncio.Lock()
        self._state: dict[str, Any] = {
            "schema": 3,
            "fingerprint_key": secrets.token_hex(32),
            "users": {},
            "bindings": {},
            "tombstones": {},
            "ignored": {},
            "retired_cards": {},
            "retired_pins": {},
            "admin_audit": {"next": 1, "records": []},
            "operation_receipts": {},
        }

    async def async_load(self, data: dict[str, Any] | None) -> None:
        async with self._lock:
            if data is None:
                await self._save(deepcopy(self._state))
                return
            migrated = False
            legacy_keys = set(self._state) - {"admin_audit", "operation_receipts"}
            if data.get("schema") == 1 and set(data) == legacy_keys - {"retired_pins"}:
                data = {**deepcopy(data), "schema": 2, "retired_pins": {}}
                migrated = True
            if data.get("schema") == 2 and set(data) == legacy_keys:
                data = {
                    **deepcopy(data),
                    "schema": 3,
                    "admin_audit": {"next": 1, "records": []},
                    "operation_receipts": {},
                }
                migrated = True
            try:
                if data.get("schema") != 3 or set(data) != set(self._state):
                    raise AccessError("invalid_storage")
                if len(bytes.fromhex(data["fingerprint_key"])) != 32:
                    raise AccessError("invalid_storage")
                for key in (
                    "users",
                    "bindings",
                    "tombstones",
                    "ignored",
                    "retired_cards",
                    "retired_pins",
                ):
                    if not isinstance(data[key], dict):
                        raise AccessError("invalid_storage")
                normalized = deepcopy(data)
                for key, raw in data["users"].items():
                    user = ManagedUser.from_private(raw)
                    if user.id != key:
                        raise AccessError("invalid_storage")
                    for assignment in user.assignments.values():
                        if assignment.sync_state == "syncing":
                            assignment.sync_state = "pending"
                    normalized["users"][key] = user.private()
                # Ownership and tombstones are authoritative; never default corrupt data away.
                for station, bindings in data["bindings"].items():
                    if not isinstance(station, str) or not isinstance(bindings, dict):
                        raise AccessError("invalid_storage")
                    for user_id, binding in bindings.items():
                        if (
                            not isinstance(binding, dict)
                            or not isinstance(binding.get("employee_no"), str)
                            or user_id not in data["users"]
                            and user_id not in data["tombstones"]
                        ):
                            raise AccessError("invalid_storage")
                for user_id, tombstone in data["tombstones"].items():
                    if (
                        user_id in data["users"]
                        or not isinstance(tombstone, dict)
                        or not isinstance(tombstone.get("targets"), list)
                        or not isinstance(tombstone.get("confirmed"), list)
                        or not isinstance(tombstone.get("employee_no"), str)
                    ):
                        raise AccessError("invalid_storage")
                validate_storage(normalized["admin_audit"], normalized["operation_receipts"])
                self._validate_journal(normalized)
                self._validate_collisions(normalized)
            except (KeyError, TypeError, ValueError, AttributeError):
                raise AccessError("invalid_storage") from None
            if migrated:
                await self._save(deepcopy(normalized))
            self._state = normalized

    @staticmethod
    def _validate_journal(state: dict[str, Any]) -> None:
        from .models import SYNC_STATES, text_field, uuid_text

        def stations(value: Any) -> set[str]:
            if not isinstance(value, list) or len(value) != len(set(value)):
                raise AccessError("invalid_storage")
            return {text_field(item, 128) for item in value}

        records = {key: ManagedUser.from_private(raw) for key, raw in state["users"].items()}
        for key, item in state["tombstones"].items():
            user = ManagedUser.from_private(item["record"])
            if (
                key != user.id
                or item.get("user_id") != key
                or item["employee_no"] != user.employee_no
            ):
                raise AccessError("invalid_storage")
            if not stations(item["confirmed"]) <= stations(item["targets"]):
                raise AccessError("invalid_storage")
            records[key] = user
        for station, bindings in state["bindings"].items():
            text_field(station, 128)
            for user_id, binding in bindings.items():
                user = records[user_id]
                if (
                    binding["employee_no"] != user.employee_no
                    or type(binding.get("adopted")) is not bool
                ):
                    raise AccessError("invalid_storage")
                if binding.get("fingerprint") is not None:
                    text_field(binding["fingerprint"], 128)
                if binding.get("sync_state", "pending") not in SYNC_STATES:
                    raise AccessError("invalid_storage")
                intent = binding.get("intent")
                if intent is not None:
                    if (
                        not isinstance(intent, dict)
                        or intent.get("operation") not in {"create", "update", "delete"}
                        or type(intent.get("revision")) is not int
                        or not 1 <= intent["revision"] <= user.revision
                    ):
                        raise AccessError("invalid_storage")
                    text_field(intent["desired_fingerprint"], 128)
                    if intent.get("before_fingerprint") is not None:
                        text_field(intent["before_fingerprint"], 128)
        for kind in ("retired_cards", "retired_pins"):
            for key, item in state[kind].items():
                uuid_text(key)
                if item["user_id"] not in records or not stations(item["confirmed"]) <= stations(
                    item["targets"]
                ):
                    raise AccessError("invalid_storage")
                secret = item["pin" if kind == "retired_pins" else "card_no"]
                text_field(secret, 32)
        for station, employees in state["ignored"].items():
            text_field(station, 128)
            stations(employees)

    def preview_copy(self) -> AccessRepository:
        """Detached state for CPU-only planning; no persistence method is used on this copy."""
        copied = AccessRepository(self._save)
        copied._state = self.snapshot()
        return copied

    async def _commit(self, change: Callable[[dict[str, Any]], T], *, offload: bool = False) -> T:
        actor, action = current_actor()
        async with self._lock:

            def prepare() -> tuple[dict[str, Any], T]:
                candidate = deepcopy(self._state)
                result = change(candidate)
                self._validate_collisions(candidate)
                append_changes(self._state, candidate, actor, action)
                return candidate, result

            offload = (
                offload
                or len(self._state["users"]) > 100
                or len(self._state["admin_audit"]["records"]) > 100
            )
            candidate, result = await asyncio.to_thread(prepare) if offload else prepare()
            if candidate != self._state:
                saving = asyncio.ensure_future(self._save(deepcopy(candidate)))
                cancelled = False
                while not saving.done():
                    try:
                        await asyncio.shield(saving)
                    except asyncio.CancelledError:
                        # Repeated shutdown cancellation must not release this lock while
                        # an executor is still persisting the previous revision.
                        cancelled = True
                saving.result()
                self._state = candidate
                if cancelled:
                    raise asyncio.CancelledError
            return deepcopy(result)

    @staticmethod
    def _validate_collisions(state: dict[str, Any]) -> None:
        employees: set[str] = set()
        cards: dict[str, str] = {}
        pins: dict[str, str] = {}
        records = list(state["users"].values()) + [
            item["record"] for item in state["tombstones"].values()
        ]
        for record in records:
            employee = record["employee_no"]
            if employee in employees:
                raise AccessError("employee_conflict")
            employees.add(employee)
            pin = record.get("pin")
            if pin is not None:
                if pin in pins:
                    raise AccessError("pin_conflict")
                pins[pin] = record["id"]
            for card in record["cards"]:
                number = card["card_no"]
                if number in cards:
                    raise AccessError("card_conflict")
                cards[number] = record["id"]
        for retired in state["retired_pins"].values():
            pin, owner = retired["pin"], retired["user_id"]
            if pin in pins and pins[pin] != owner:
                raise AccessError("pin_removal_pending")
            pins[pin] = owner
        for retired in state["retired_cards"].values():
            number, owner = retired["card_no"], retired["user_id"]
            if number in cards and cards[number] != owner:
                raise AccessError("card_removal_pending")
            cards[number] = owner

    def snapshot(self) -> dict[str, Any]:
        """Private engine view. The caller receives a detached copy."""
        return deepcopy(self._state)

    def users(self) -> list[ManagedUser]:
        return [ManagedUser.from_private(item) for item in self._state["users"].values()]

    def get(self, user_id: str) -> ManagedUser:
        raw = self._state["users"].get(user_id)
        if raw is None:
            raise AccessError("user_not_found")
        return ManagedUser.from_private(raw)

    def public(self) -> dict[str, Any]:
        return deepcopy(
            {
                "users": [user.public() for user in self.users()],
                "revocations": [
                    {
                        "station_id": station,
                        "user_id": user_id,
                        "sync_state": binding.get("sync_state", "pending"),
                        "last_error": binding.get("last_error"),
                    }
                    for station, bindings in self._state["bindings"].items()
                    for user_id, binding in bindings.items()
                    if user_id in self._state["users"]
                    and station not in self._state["users"][user_id]["assignments"]
                ],
                "card_removals": [
                    {
                        "id": key,
                        "user_id": item["user_id"],
                        "targets": item["targets"],
                        "confirmed": item["confirmed"],
                    }
                    for key, item in self._state["retired_cards"].items()
                ],
                "pin_removals": [
                    {
                        "id": key,
                        "user_id": item["user_id"],
                        "targets": item["targets"],
                        "confirmed": item["confirmed"],
                    }
                    for key, item in self._state["retired_pins"].items()
                ],
                "tombstones": [
                    {key: value for key, value in item.items() if key != "record"}
                    for item in self._state["tombstones"].values()
                ],
            }
        )

    def fingerprint(self, payload: Mapping[str, Any]) -> str:
        encoded = json.dumps(
            payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")
        ).encode()
        return hmac.new(
            bytes.fromhex(self._state["fingerprint_key"]), encoded, hashlib.sha256
        ).hexdigest()

    async def async_create(self, data: dict[str, Any]) -> ManagedUser:
        def create(state: dict[str, Any]) -> ManagedUser:
            employees = {item["employee_no"] for item in state["users"].values()} | {
                item["employee_no"] for item in state["tombstones"].values()
            }
            while (employee := str(100_000_000 + secrets.randbelow(900_000_000))) in employees:
                pass
            user = build_user(data, employee_no=employee, now=utc_now())
            state["users"][user.id] = user.private()
            return user

        return await self._commit(create)

    async def async_update(
        self, user_id: str, data: dict[str, Any], *, expected_revision: int
    ) -> ManagedUser:
        return await self._commit(
            lambda state: self._update_user(state, user_id, data, expected_revision)
        )

    def _update_user(
        self, state: dict[str, Any], user_id: str, data: dict[str, Any], expected_revision: int
    ) -> ManagedUser:
        if user_id not in state["users"]:
            raise AccessError("user_not_found")
        old = ManagedUser.from_private(state["users"][user_id])
        if type(expected_revision) is not int or old.revision != expected_revision:
            raise AccessError("revision_conflict")
        user = build_user(data, employee_no=old.employee_no, now=utc_now(), previous=old)
        if user.employee_no != old.employee_no and old.identity_locked:
            raise AccessError("identity_migration_required")
        desired_numbers = {card.card_no.value for card in user.cards}
        removed = [card for card in old.cards if card.card_no.value not in desired_numbers]
        targets = set(old.assignments) | {
            station for station, bindings in state["bindings"].items() if user_id in bindings
        }
        self._retire_pin(state, old, user, targets)
        for card in removed:
            if targets:
                state["retired_cards"][str(uuid4())] = {
                    "user_id": user_id,
                    "card_no": card.card_no.value,
                    "targets": sorted(targets),
                    "confirmed": [],
                }
        # Re-adding to the same person cancels retirement and preserves ownership.
        for key, retired in list(state["retired_cards"].items()):
            if retired["user_id"] == user_id and retired["card_no"] in desired_numbers:
                del state["retired_cards"][key]
        state["users"][user.id] = user.private()
        return user

    def bulk_stamp(self, state: dict[str, Any] | None = None) -> str:
        """Ignore sync progress, but bind desired revisions and ownership/cleanup targets."""
        state = self._state if state is None else state
        return self.fingerprint(
            {
                "users": {
                    key: [u["employee_no"], u["revision"], u["identity_locked"]]
                    for key, u in state["users"].items()
                },
                "tombstones": sorted(state["tombstones"]),
                "bindings": {key: sorted(records) for key, records in state["bindings"].items()},
                "retired_cards": state["retired_cards"],
                "retired_pins": state["retired_pins"],
            }
        )

    def _bulk_users(
        self, state: dict[str, Any], changes: list[dict[str, Any]]
    ) -> list[ManagedUser]:
        users = []
        for change in changes:
            if change["user_id"] is None:
                user = build_user(
                    change["data"], employee_no=change["data"]["employee_no"], now=utc_now()
                )
                state["users"][user.id] = user.private()
            else:
                user = self._update_user(
                    state, change["user_id"], change["data"], change["revision"]
                )
            users.append(user)
        self._validate_collisions(state)
        return users

    def preview_bulk(self, changes: list[dict[str, Any]]) -> list[ManagedUser]:
        return self._bulk_users(self.snapshot(), changes)

    async def async_bulk_apply(
        self,
        changes: list[dict[str, Any]],
        *,
        stamp: str,
        validate: Callable[[ManagedUser], None],
    ) -> list[ManagedUser]:
        def apply(state: dict[str, Any]) -> list[ManagedUser]:
            if stamp != self.bulk_stamp(state):
                raise AccessError("csv_review_stale")
            users = self._bulk_users(state, changes)
            for user in users:
                validate(user)
            return users

        return await self._commit(apply, offload=True)

    async def async_delete(self, user_id: str, *, expected_revision: int) -> None:
        await self._commit(lambda state: self._delete_user(state, user_id, expected_revision))

    def _delete_user(self, state: dict[str, Any], user_id: str, expected_revision: int) -> None:
        if user_id not in state["users"]:
            raise AccessError("user_not_found")
        record = state["users"][user_id]
        if type(expected_revision) is not int or record["revision"] != expected_revision:
            raise AccessError("revision_conflict")
        targets = set(record["assignments"]) | {
            station for station, bindings in state["bindings"].items() if user_id in bindings
        }
        targets |= {
            station
            for card in state["retired_cards"].values()
            if card["user_id"] == user_id
            for station in card["targets"]
        }
        targets |= {
            station
            for item in state["retired_pins"].values()
            if item["user_id"] == user_id
            for station in item["targets"]
        }
        if targets:
            state["tombstones"][user_id] = {
                "user_id": user_id,
                "employee_no": record["employee_no"],
                "targets": sorted(targets),
                "confirmed": [],
                "created_at": utc_now(),
                "stations": {
                    target: {"sync_state": "delete_pending", "last_error": None}
                    for target in targets
                },
                "record": record,
            }
        del state["users"][user_id]

    async def async_apply_operation(
        self,
        changes: list[dict[str, Any]],
        *,
        stamp: str,
        receipt: dict[str, Any],
        validate: Callable[[ManagedUser], None],
    ) -> dict[str, Any]:
        def apply(state: dict[str, Any]) -> dict[str, Any]:
            existing: dict[str, Any] | None = state["operation_receipts"].get(
                receipt["operation_id"]
            )
            if existing:
                if existing["actor"] != receipt["actor"]:
                    raise AccessError("operation_not_found")
                return existing
            if self.bulk_stamp(state) != stamp:
                raise AccessError("bulk_review_stale")
            for change in changes:
                if change["delete"]:
                    self._delete_user(state, change["user_id"], change["revision"])
                else:
                    user = self._update_user(
                        state, change["user_id"], change["data"], change["revision"]
                    )
                    validate(user)
            state["operation_receipts"][receipt["operation_id"]] = deepcopy(receipt)
            # Expired receipt IDs cannot be replayed without their missing review token.
            while len(state["operation_receipts"]) > 1000:
                oldest = min(
                    state["operation_receipts"],
                    key=lambda key: state["operation_receipts"][key]["saved_at"],
                )
                del state["operation_receipts"][oldest]
            return receipt

        return await self._commit(apply, offload=True)

    def event_person_name(self, station: str, employee_no: str, occurred_at: str) -> str | None:
        """Resolve only an observed owner on this station, never a pending ID collision.

        Historic records predating central ownership remain unidentified when the source
        supplies no name. The same employee number may have belonged to another person.
        """
        try:
            when = datetime.fromisoformat(occurred_at)
            if when.tzinfo is None:
                return None
        except (ValueError, TypeError):
            return None
        for uid, binding in self._state["bindings"].get(station, {}).items():
            raw = self._state["users"].get(uid)
            if (
                raw is None
                or binding["employee_no"] != employee_no
                or raw["employee_no"] != employee_no
                or not binding["fingerprint"]
            ):
                continue
            created = datetime.fromisoformat(raw["created_at"])
            if created <= when:
                return str(raw["display_name"])
        return None

    async def async_bind(
        self,
        station: str,
        user_id: str,
        *,
        fingerprint: str | None,
        intent: dict[str, Any] | None = None,
        adopted: bool = False,
    ) -> None:
        """Persist explicit adoption or a create intent before any physical write."""

        def bind(state: dict[str, Any]) -> None:
            user = state["users"].get(user_id)
            if user is None:
                raise AccessError("user_not_found")
            state["bindings"].setdefault(station, {})[user_id] = {
                "employee_no": user["employee_no"],
                "fingerprint": fingerprint,
                "intent": intent,
                "adopted": adopted,
            }
            user["identity_locked"] = True

        await self._commit(bind)

    async def async_record_observation(
        self, station: str, user_id: str, *, fingerprint: str, applied_revision: int | None
    ) -> None:
        def observed(state: dict[str, Any]) -> None:
            binding = state["bindings"].get(station, {}).get(user_id)
            if binding is None:
                raise AccessError("ownership_missing")
            raw = state["users"].get(user_id)
            assignment = raw["assignments"].get(station) if raw else None
            if (
                binding["fingerprint"] == fingerprint
                and binding.get("intent") is None
                and assignment
                and assignment["sync_state"] == "synced"
                and applied_revision == raw["revision"] == assignment["applied_revision"]
            ):
                return
            binding["fingerprint"], binding["intent"] = fingerprint, None
            binding["sync_state"], binding["last_error"] = "pending", None
            if user_id in state["users"]:
                user = state["users"][user_id]
                assignment = user["assignments"].get(station)
                if assignment and applied_revision == user["revision"]:
                    binding["sync_state"] = "synced"
                    assignment.update(
                        applied_revision=applied_revision,
                        sync_state="synced",
                        last_sync_at=utc_now(),
                        last_error=None,
                    )
                elif assignment:
                    assignment["sync_state"] = "pending"

        await self._commit(observed)

    async def async_mark(
        self, station: str, user_id: str, status: str, error: str | None = None
    ) -> None:
        from .models import SYNC_STATES

        if (
            status not in SYNC_STATES
            or error is not None
            and (
                not isinstance(error, str)
                or len(error) > 64
                or not all(c.isascii() and (c.isalnum() or c == "_") for c in error)
            )
        ):
            raise AccessError("invalid_sync_status")

        def mark(state: dict[str, Any]) -> None:
            user = state["users"].get(user_id)
            if user and (assignment := user["assignments"].get(station)):
                assignment["sync_state"], assignment["last_error"] = status, error
            binding = state["bindings"].get(station, {}).get(user_id)
            if binding is not None:
                binding["sync_state"], binding["last_error"] = status, error
            tombstone = state["tombstones"].get(user_id)
            if tombstone is not None and station in tombstone["targets"]:
                tombstone.setdefault("stations", {})[station] = {
                    "sync_state": status,
                    "last_error": error,
                }

        await self._commit(mark)

    async def async_confirm_absent(
        self, station: str, user_id: str, *, revision: int | None = None
    ) -> None:
        def absent(state: dict[str, Any]) -> None:
            state["bindings"].get(station, {}).pop(user_id, None)
            self._confirm_retired(state, station, user_id, set())
            self._confirm_retired_pins(state, station, user_id, "")
            tombstone = state["tombstones"].get(user_id)
            if tombstone:
                tombstone.setdefault("stations", {})[station] = {
                    "sync_state": "synced",
                    "last_error": None,
                }
                tombstone["confirmed"] = sorted(set(tombstone["confirmed"]) | {station})
                if set(tombstone["targets"]) <= set(tombstone["confirmed"]):
                    del state["tombstones"][user_id]
            elif user_id in state["users"]:
                user = state["users"][user_id]
                assignment = user["assignments"].get(station)
                if (
                    assignment
                    and revision == user["revision"]
                    and not (
                        assignment["sync_state"] == "synced"
                        and assignment["applied_revision"] == revision
                    )
                ):
                    assignment.update(
                        applied_revision=revision,
                        sync_state="synced",
                        last_sync_at=utc_now(),
                        last_error=None,
                    )

        await self._commit(absent)

    async def async_ignore(self, station: str, employee_no: str, *, ignored: bool) -> None:
        from ..client.access import validate_identifier

        validate_identifier(employee_no)

        def ignore(state: dict[str, Any]) -> None:
            records = state["ignored"].setdefault(station, [])
            if ignored and employee_no not in records:
                records.append(employee_no)
            elif not ignored and employee_no in records:
                records.remove(employee_no)

        await self._commit(ignore)

    @staticmethod
    def _confirm_retired(
        state: dict[str, Any], station: str, user_id: str, present_cards: set[str]
    ) -> None:
        for key, retired in list(state["retired_cards"].items()):
            if (
                retired["user_id"] != user_id
                or station not in retired["targets"]
                or retired["card_no"] in present_cards
            ):
                continue
            retired["confirmed"] = sorted(set(retired["confirmed"]) | {station})
            if set(retired["targets"]) <= set(retired["confirmed"]):
                del state["retired_cards"][key]

    @staticmethod
    def _retire_pin(
        state: dict[str, Any], previous: ManagedUser, desired: ManagedUser, targets: set[str]
    ) -> None:
        old = previous.pin.value if previous.pin else None
        new = desired.pin.value if desired.pin else None
        if old and old != new and targets:
            state["retired_pins"][str(uuid4())] = {
                "user_id": previous.id,
                "pin": old,
                "targets": sorted(targets),
                "confirmed": [],
            }
        for key, item in list(state["retired_pins"].items()):
            if item["user_id"] == previous.id and item["pin"] == new:
                del state["retired_pins"][key]

    @staticmethod
    def _confirm_retired_pins(
        state: dict[str, Any], station: str, user_id: str, present_pin: str
    ) -> None:
        for key, item in list(state["retired_pins"].items()):
            if (
                item["user_id"] != user_id
                or station not in item["targets"]
                or item["pin"] == present_pin
            ):
                continue
            item["confirmed"] = sorted(set(item["confirmed"]) | {station})
            if set(item["targets"]) <= set(item["confirmed"]):
                del state["retired_pins"][key]

    async def async_confirm_pin_removals(
        self, station: str, user_id: str, present_pin: str
    ) -> None:
        await self._commit(
            lambda state: self._confirm_retired_pins(state, station, user_id, present_pin)
        )

    async def async_confirm_card_removals(
        self, station: str, user_id: str, present_cards: set[str]
    ) -> None:
        await self._commit(
            lambda state: self._confirm_retired(state, station, user_id, present_cards)
        )

    async def async_adopt(
        self,
        station: str,
        data: dict[str, Any],
        *,
        fingerprint: str,
        existing_user_id: str | None = None,
        expected_revision: int | None = None,
        delete: bool = False,
    ) -> ManagedUser:
        """Adoption, desired assignment and ownership become durable in one commit."""
        if delete and existing_user_id is not None:
            raise AccessError("invalid_operation")

        def adopt(state: dict[str, Any]) -> ManagedUser:
            previous = None
            if existing_user_id is not None:
                raw = state["users"].get(existing_user_id)
                if raw is None:
                    raise AccessError("user_not_found")
                previous = ManagedUser.from_private(raw)
                if type(expected_revision) is not int or expected_revision != previous.revision:
                    raise AccessError("revision_conflict")
                if data.get("employee_no") != previous.employee_no:
                    raise AccessError("identity_migration_required")
            desired = {"employee_no": previous.employee_no} if previous else data
            user = build_user(
                desired, employee_no=data["employee_no"], now=utc_now(), previous=previous
            )
            from .models import StationAssignment

            user.assignments[station] = StationAssignment(
                station, True, frozenset({1}), desired_revision=user.revision
            )
            user.identity_locked = True
            if user.id in state["bindings"].get(station, {}):
                raise AccessError("already_managed")
            state["users"][user.id] = user.private()
            state["bindings"].setdefault(station, {})[user.id] = {
                "employee_no": user.employee_no,
                "fingerprint": fingerprint,
                "intent": None,
                "adopted": True,
            }
            if delete:
                state["tombstones"][user.id] = {
                    "user_id": user.id,
                    "employee_no": user.employee_no,
                    "targets": [station],
                    "confirmed": [],
                    "created_at": utc_now(),
                    "stations": {station: {"sync_state": "delete_pending", "last_error": None}},
                    "record": state["users"].pop(user.id),
                }
            return user

        return await self._commit(adopt)

    async def async_write_intent(
        self,
        station: str,
        user_id: str,
        *,
        revision: int,
        expected_fingerprint: str | None,
        desired_fingerprint: str,
        operation: str,
        before_fingerprint: str | None = None,
    ) -> None:
        """Journal a bounded operation before sending it; never lose a concurrent edit."""
        if (
            type(revision) is not int
            or revision < 1
            or operation not in {"create", "update", "delete"}
        ):
            raise AccessError("invalid_operation")

        def intent(state: dict[str, Any]) -> None:
            user = state["users"].get(user_id)
            tombstone = state["tombstones"].get(user_id)
            if user is None and tombstone is None:
                raise AccessError("user_not_found")
            if user is not None and user["revision"] != revision:
                raise AccessError("revision_conflict")
            record = user if user is not None else tombstone["record"]
            if user is None and (operation != "delete" or record["revision"] != revision):
                raise AccessError("revision_conflict")
            bindings = state["bindings"].setdefault(station, {})
            binding = bindings.get(user_id)
            if binding is None:
                if operation != "create" or expected_fingerprint is not None:
                    raise AccessError("ownership_missing")
                binding = bindings[user_id] = {
                    "employee_no": record["employee_no"],
                    "fingerprint": None,
                    "intent": None,
                    "adopted": False,
                }
            if binding["fingerprint"] != expected_fingerprint:
                raise AccessError("revision_conflict")
            binding["intent"] = {
                "operation": operation,
                "revision": revision,
                "desired_fingerprint": desired_fingerprint,
                "before_fingerprint": before_fingerprint,
            }
            if user is not None:
                user["identity_locked"] = True

        await self._commit(intent)

    async def async_resolve(
        self,
        station: str,
        user_id: str,
        *,
        fingerprint: str,
        expected_revision: int,
        device_data: dict[str, Any] | None = None,
    ) -> ManagedUser:
        """Explicit administrator resolution, atomically rebasing ownership and desired state."""

        def resolve(state: dict[str, Any]) -> ManagedUser:
            raw = state["users"].get(user_id)
            binding = state["bindings"].get(station, {}).get(user_id)
            if raw is None or binding is None:
                raise AccessError("ownership_missing")
            previous = ManagedUser.from_private(raw)
            if type(expected_revision) is not int or previous.revision != expected_revision:
                raise AccessError("revision_conflict")
            user = build_user(
                device_data or {},
                employee_no=previous.employee_no,
                now=utc_now(),
                previous=previous,
            )
            if user.employee_no != previous.employee_no:
                raise AccessError("identity_migration_required")
            # Accepting the device is a central edit; keep removed-card reservations until
            # every formerly assigned station confirms removal, just as for ordinary CRUD.
            removed = {card.card_no.value for card in previous.cards} - {
                card.card_no.value for card in user.cards
            }
            targets = set(previous.assignments) | {
                key for key, records in state["bindings"].items() if user_id in records
            }
            self._retire_pin(state, previous, user, targets)
            for number in removed:
                if targets:
                    state["retired_cards"][str(uuid4())] = {
                        "user_id": user_id,
                        "card_no": number,
                        "targets": sorted(targets),
                        "confirmed": [],
                    }
            state["users"][user_id] = user.private()
            binding.update(
                fingerprint=fingerprint, intent=None, sync_state="pending", last_error=None
            )
            return user

        return await self._commit(resolve)

    async def async_resolve_deletion(self, station: str, user_id: str, *, fingerprint: str) -> None:
        """Administrator explicitly reviewed the current record before continuing deletion."""

        def resolve(state: dict[str, Any]) -> None:
            tombstone = state["tombstones"].get(user_id)
            if (
                tombstone is None
                or station not in tombstone["targets"]
                or station in tombstone["confirmed"]
            ):
                raise AccessError("deletion_not_pending")
            state["bindings"].setdefault(station, {})[user_id] = {
                "employee_no": tombstone["employee_no"],
                "fingerprint": fingerprint,
                "intent": None,
                "adopted": True,
                "sync_state": "delete_pending",
                "last_error": None,
            }
            tombstone.setdefault("stations", {})[station] = {
                "sync_state": "delete_pending",
                "last_error": None,
            }

        await self._commit(resolve)
