"""Durable, explicitly reviewed access workflows. Never sends messages automatically."""

from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from . import renewal_identity
from .csv_transfer import validate_csv_targets
from .models import AccessError, ManagedUser, utc_now

if TYPE_CHECKING:
    from .manager import AccessManager


def defaults() -> dict[str, Any]:
    return {
        "revision": 0,
        "settings": {"idle_minutes": 0, "reauth_sensitive": False, "dual_approval": False},
        "approvals": {},
        "transfers": {},
        "inventory": {},
        "templates": {},
        "reminders": {},
        "renewals": {},
        "renewal_identity": renewal_identity.defaults(),
    }


def validate(value: Any) -> None:
    """Reject malformed workflow journals before any reconciliation can resume."""
    from ..client.access import validate_card
    from .models import text_field

    def instant(raw: Any) -> None:
        if not isinstance(raw, str) or len(raw) > 64 or datetime.fromisoformat(raw).tzinfo is None:
            raise AccessError("invalid_storage")

    def inventory(raw: Any) -> None:
        if not isinstance(raw, dict) or set(raw) != {
            "card_no",
            "label",
            "status",
            "return_by",
            "revision",
        }:
            raise AccessError("invalid_storage")
        validate_card(raw["card_no"])
        text_field(raw["label"], 64)
        if (
            raw["status"] not in {"available", "lost", "blocked", "temporary"}
            or type(raw["revision"]) is not int
            or raw["revision"] < 1
        ):
            raise AccessError("invalid_storage")
        if raw["return_by"] is not None:
            instant(raw["return_by"])

    try:
        if not isinstance(value, dict) or set(value) != set(defaults()):
            raise AccessError("invalid_storage")
        if type(value["revision"]) is not int or value["revision"] < 0:
            raise AccessError("invalid_storage")
        validate_settings(value["settings"])
        renewal_identity.checked(value["renewal_identity"])
        for key in ("approvals", "transfers", "inventory", "templates", "reminders", "renewals"):
            if not isinstance(value[key], dict) or len(value[key]) > (
                2000 if key == "reminders" else 64 if key == "templates" else 500
            ):
                raise AccessError("invalid_storage")
            for identity, item in value[key].items():
                text_field(identity, 128)
                if not isinstance(item, dict):
                    raise AccessError("invalid_storage")
                if (
                    key in {"approvals", "transfers", "templates", "renewals"}
                    and item.get("id") != identity
                ):
                    raise AccessError("invalid_storage")
        for item in value["approvals"].values():
            if set(item) != {
                "id",
                "actor",
                "approver",
                "state",
                "changes",
                "stamp",
                "rules",
                "created_at",
                "expires_at",
                "label",
                "effects",
                "impact",
            }:
                raise AccessError("invalid_storage")
            text_field(item["actor"], 128)
            text_field(item["label"], 100)
            if item["approver"] is not None:
                text_field(item["approver"], 128)
                if item["approver"] == item["actor"]:
                    raise AccessError("invalid_storage")
            if item["state"] not in {"pending", "approved", "rejected", "applied", "cancelled"}:
                raise AccessError("invalid_storage")
            instant(item["created_at"])
            instant(item["expires_at"])
            for key in ("changes", "effects", "impact"):
                if not isinstance(item[key], list) or len(item[key]) > 2000:
                    raise AccessError("invalid_storage")
            for change in item["changes"]:
                if (
                    not isinstance(change, dict)
                    or not {"user_id", "revision", "data"}
                    <= set(change)
                    <= {"user_id", "revision", "data", "delete", "archive"}
                    or not isinstance(change["data"], dict)
                ):
                    raise AccessError("invalid_storage")
                if "archive" in change and (
                    type(change["archive"]) is not bool
                    or not change["user_id"]
                    or change.get("delete")
                    or change["data"] != {"active": False}
                ):
                    raise AccessError("invalid_storage")
                if change["user_id"] is not None:
                    text_field(change["user_id"], 128)
                    if type(change["revision"]) is not int or change["revision"] < 1:
                        raise AccessError("invalid_storage")
                elif change["revision"] is not None or change.get("delete"):
                    raise AccessError("invalid_storage")
            for effect in item["effects"]:
                if (
                    not isinstance(effect, dict)
                    or set(effect) != {"id", "revision", "values"}
                    or type(effect["revision"]) is not int
                    or effect["revision"] < 0
                ):
                    raise AccessError("invalid_storage")
                text_field(effect["id"], 128)
                inventory({**effect["values"], "revision": effect["revision"] + 1})
        for item in value["transfers"].values():
            if set(item) != {
                "id",
                "actor",
                "kind",
                "source",
                "target",
                "source_name",
                "target_revision",
                "state",
                "source_revision",
                "source_card",
                "approved_by",
                "plan",
                "created_at",
            }:
                raise AccessError("invalid_storage")
            if item["kind"] not in {"card", "identity", "merge"} or item["state"] not in {
                "awaiting_revocation",
                "awaiting_approval",
                "approved",
                "ready",
                "completed",
                "cancelled",
            }:
                raise AccessError("invalid_storage")
            for key in ("actor", "source", "source_name"):
                text_field(item[key], 128)
            text_field(item["target"], 128, empty=item["kind"] == "identity")
            if (
                type(item["source_revision"]) is not int
                or item["source_revision"] < 1
                or not isinstance(item["plan"], dict)
            ):
                raise AccessError("invalid_storage")
            if item["approved_by"] is not None:
                text_field(item["approved_by"], 128)
                if item["approved_by"] == item["actor"]:
                    raise AccessError("invalid_storage")
            instant(item["created_at"])
        for item in value["inventory"].values():
            inventory(item)
        for item in value["templates"].values():
            if (
                set(item) != {"id", "revision", "label", "data", "message"}
                or type(item["revision"]) is not int
                or item["revision"] < 1
                or not isinstance(item["data"], dict)
                or not isinstance(item["message"], str)
                or len(item["message"]) > 4000
            ):
                raise AccessError("invalid_storage")
            text_field(item["label"], 80)
            if set(item["data"]) - {
                "profile",
                "group_ids",
                "permission_overrides",
                "assignments",
                "access_timing_policy",
                "valid_from",
                "valid_until",
            }:
                raise AccessError("invalid_storage")
        for item in value["reminders"].values():
            if set(item) != {"state", "actor", "at", "until"} or item["state"] not in {
                "acknowledged",
                "snoozed",
            }:
                raise AccessError("invalid_storage")
            text_field(item["actor"], 128)
            instant(item["at"])
            if item["until"] is not None:
                instant(item["until"])
        for item in value["renewals"].values():
            if (
                set(item) - {"binding", "request_key", "reviewer"}
                != {
                    "id",
                    "actor",
                    "user_id",
                    "revision",
                    "until",
                    "reason",
                    "state",
                    "created_at",
                    "approver",
                }
                or item["state"] not in {"pending", "approved", "rejected", "cancelled"}
                or type(item["revision"]) is not int
                or item["revision"] < 1
            ):
                raise AccessError("invalid_storage")
            for key in ("actor", "user_id"):
                text_field(item[key], 128)
            text_field(item["reason"], 240)
            instant(item["until"])
            instant(item["created_at"])
            if "binding" in item or "request_key" in item:
                proof = item.get("binding")
                if (
                    not isinstance(proof, dict)
                    or set(proof) != {"actor", "user_id", "generation"}
                    or proof["actor"] != item["actor"]
                    or proof["user_id"] != item["user_id"]
                    or type(proof["generation"]) is not int
                    or proof["generation"] < 1
                ):
                    raise AccessError("invalid_storage")
                text_field(item["request_key"], 64)
                if item.get("reviewer") is not None:
                    text_field(item["reviewer"], 128)
            elif "reviewer" in item:
                raise AccessError("invalid_storage")
    except (AccessError, ValueError, TypeError, KeyError):
        raise AccessError("invalid_storage") from None


def validate_settings(value: Any) -> dict[str, Any]:
    if (
        not isinstance(value, dict)
        or set(value) != set(defaults()["settings"])
        or type(value["idle_minutes"]) is not int
        or not 0 <= value["idle_minutes"] <= 120
        or any(type(value[key]) is not bool for key in ("reauth_sensitive", "dual_approval"))
    ):
        raise AccessError("invalid_fields")
    return deepcopy(value)


def _reserve(collection: dict[str, Any], limit: int = 500) -> None:
    if len(collection) >= limit:
        terminal = [
            key
            for key, item in collection.items()
            if item.get("state") in {"rejected", "applied", "cancelled", "completed", "approved"}
            and not item.get("plan")
            and not item.get("changes")
        ]
        if not terminal:
            raise AccessError("workflow_limit")
        oldest = min(terminal, key=lambda key: collection[key].get("created_at", ""))
        del collection[oldest]


def _public_approval(item: dict[str, Any], names: dict[str, str]) -> dict[str, Any]:
    return {
        key: deepcopy(item[key])
        for key in ("id", "actor", "approver", "state", "created_at", "expires_at", "label")
    } | {
        "impact": deepcopy(item["impact"]),
        "inventory": [
            {"label": effect["values"]["label"], "status": effect["values"]["status"]}
            for effect in item["effects"]
        ],
        "people": [
            {
                "name": names.get(change["user_id"], change["data"].get("display_name", "")),
                "delete": bool(change.get("delete")),
                **({"archive": change["archive"]} if "archive" in change else {}),
                "fields": sorted(change["data"]) + (["archived_at"] if "archive" in change else []),
            }
            for change in item["changes"]
        ],
    }


class Workflows:
    def __init__(self, manager: AccessManager) -> None:
        self.manager = manager
        self.repository = manager.repository

    @property
    def data(self) -> dict[str, Any]:
        result: dict[str, Any] = self.repository._state["workflows"]
        return result

    def settings(self) -> dict[str, Any]:
        return {"revision": self.data["revision"], **deepcopy(self.data["settings"])}

    async def update_settings(self, revision: int, values: dict[str, Any]) -> dict[str, Any]:
        values = validate_settings(values)

        def apply(state: dict[str, Any]) -> None:
            data = state["workflows"]
            if type(revision) is not int or data["revision"] != revision:
                raise AccessError("revision_conflict")
            data["settings"] = values
            data["revision"] += 1

        await self.repository._commit(apply)
        self.manager._changed()
        return self.settings()

    def approvals(self) -> list[dict[str, Any]]:
        names = {person.id: person.display_name for person in self.repository.users()}
        return [_public_approval(item, names) for item in self.data["approvals"].values()]

    async def submit(
        self,
        actor: str,
        changes: list[dict[str, Any]],
        stamp: str,
        label: str,
        effects: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        if (
            not actor
            or not 0 <= len(changes) <= 2000
            or not (changes or effects)
            or not 1 <= len(label) <= 100
        ):
            raise AccessError("invalid_fields")
        identity = uuid4().hex
        item = {
            "id": identity,
            "actor": actor,
            "approver": None,
            "state": "pending",
            "changes": deepcopy(changes),
            "impact": [],
            "effects": deepcopy(effects or []),
            "stamp": stamp,
            "rules": self.manager.bulk.rules_stamp(),
            "created_at": utc_now(),
            "expires_at": (datetime.now(UTC) + timedelta(hours=24)).isoformat(),
            "label": label,
        }

        def apply(state: dict[str, Any]) -> None:
            if stamp != self.repository.bulk_stamp(state):
                raise AccessError("bulk_review_stale")
            from .admin_audit import summary

            preview = self._preview(state, changes, effects or [])
            added = iter(raw for uid, raw in preview["users"].items() if uid not in state["users"])
            item["impact"] = [
                {
                    "before": summary(state["users"].get(change["user_id"])),
                    "after": summary(preview["users"].get(change["user_id"]))
                    if change["user_id"]
                    else summary(next(added)),
                    "timing": deepcopy(change["data"].get("access_timing_policy", "unchanged")),
                }
                for change in changes
            ]
            _reserve(state["workflows"]["approvals"])
            state["workflows"]["approvals"][identity] = item

        await self.repository._commit(apply, offload=True)
        return _public_approval(item, {p.id: p.display_name for p in self.repository.users()})

    def _preview(
        self,
        state: dict[str, Any],
        changes: list[dict[str, Any]],
        effects: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        candidate = deepcopy(state)
        for change in changes:
            if change.get("delete"):
                self.repository._delete_user(candidate, change["user_id"], change["revision"])
            elif "archive" in change:
                self.repository._archive_user(
                    candidate, change["user_id"], change["revision"], change["archive"]
                )
            else:
                user = self.repository._bulk_users(candidate, [change])[0]
                validate_csv_targets(user, self.manager._csv_rules())
        self._effects(candidate, effects or [])
        self.repository._validate_collisions(candidate)
        return candidate

    @staticmethod
    def _effects(state: dict[str, Any], effects: list[dict[str, Any]]) -> None:
        for effect in effects:
            items = state["workflows"]["inventory"]
            old = items.get(effect["id"])
            if effect["revision"] != (old["revision"] if old else 0):
                raise AccessError("revision_conflict")
            if not old:
                _reserve(items)
            values = deepcopy(effect["values"])
            if any(
                key != effect["id"] and item["card_no"] == values["card_no"]
                for key, item in items.items()
            ):
                raise AccessError("card_conflict")
            items[effect["id"]] = {**values, "revision": effect["revision"] + 1}

    def inventory_review(
        self, identity: str, revision: int, values: dict[str, Any]
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        from ..client.access import validate_card
        from .models import text_field

        if set(values) != {"card_no", "label", "status", "return_by"} or values["status"] not in {
            "available",
            "temporary",
            "lost",
            "blocked",
        }:
            raise AccessError("invalid_fields")
        old = self.data["inventory"].get(identity)
        if revision != (old["revision"] if old else 0):
            raise AccessError("revision_conflict")
        number = validate_card(values["card_no"] or (old["card_no"] if old else ""))
        if old and number != old["card_no"]:
            raise AccessError("identity_migration_required")
        due = values["return_by"]
        if due is not None and datetime.fromisoformat(due).tzinfo is None:
            raise AccessError("invalid_validity")
        changes = []
        for person in self.repository.users():
            if any(card.card_no.value == number for card in person.cards):
                if values["status"] == "available":
                    raise AccessError("card_still_assigned")
                if values["status"] in {"lost", "blocked"}:
                    changes.append(
                        {
                            "user_id": person.id,
                            "revision": person.revision,
                            "data": {
                                "cards": [
                                    card.private()
                                    for card in person.cards
                                    if card.card_no.value != number
                                ]
                            },
                        }
                    )
        effect = {
            "id": identity or uuid4().hex,
            "revision": revision,
            "values": {**values, "card_no": number, "label": text_field(values["label"], 64)},
        }
        return changes, [effect]

    async def decide(self, actor: str, identity: str, approve: bool) -> dict[str, Any]:
        def apply(state: dict[str, Any]) -> None:
            item = state["workflows"]["approvals"].get(identity)
            if not item or item["state"] != "pending":
                raise AccessError("operation_not_found")
            if item["actor"] == actor:
                raise AccessError("separate_approver_required")
            if datetime.fromisoformat(item["expires_at"]) <= datetime.now(UTC):
                raise AccessError("approval_expired")
            item.update(state="approved" if approve else "rejected", approver=actor)
            if not approve:
                item["changes"] = []
                item["effects"] = []

        await self.repository._commit(apply)
        return next(item for item in self.approvals() if item["id"] == identity)

    async def withdraw(self, actor: str, identity: str) -> dict[str, Any]:
        def apply(state: dict[str, Any]) -> None:
            item = state["workflows"]["approvals"].get(identity)
            if not item or item["actor"] != actor or item["state"] not in {"pending", "approved"}:
                raise AccessError("operation_not_found")
            item.update(state="cancelled", changes=[], effects=[])

        await self.repository._commit(apply)
        self.manager._changed()
        return {"cancelled": True}

    async def apply_approval(self, actor: str, identity: str) -> dict[str, Any]:
        affected: set[str] = set()

        def apply(state: dict[str, Any]) -> dict[str, Any]:
            item = state["workflows"]["approvals"].get(identity)
            if not item or item["actor"] != actor:
                raise AccessError("operation_not_found")
            if item["state"] == "applied":
                return {"applied": True, "replayed": True}
            if item["state"] != "approved" or not item["approver"] or item["approver"] == actor:
                raise AccessError("approval_required")
            if datetime.fromisoformat(item["expires_at"]) <= datetime.now(UTC):
                raise AccessError("approval_expired")
            if (
                item["stamp"] != self.repository.bulk_stamp(state)
                or item["rules"] != self.manager.bulk.rules_stamp()
            ):
                raise AccessError("bulk_review_stale")
            for change in item["changes"]:
                uid = change["user_id"]
                if uid:
                    affected.update(self.targets(state, uid))
                if change.get("delete"):
                    self.repository._delete_user(state, uid, change["revision"])
                elif "archive" in change:
                    user = self.repository._archive_user(
                        state, uid, change["revision"], change["archive"]
                    )
                    affected.update(user.assignments)
                else:
                    user = self.repository._bulk_users(state, [change])[0]
                    validate_csv_targets(user, self.manager._csv_rules())
                    affected.update(user.assignments)
            self._effects(state, item["effects"])
            count = len(item["changes"])
            item.update(state="applied", changes=[], effects=[])
            return {"applied": True, "changed": count}

        result = await self.repository._commit(apply, offload=True)
        for sid in affected:
            if sid in self.manager.stations:
                self.manager.request(sid)
        self.manager._changed()
        return result

    @staticmethod
    def targets(state: dict[str, Any], uid: str) -> set[str]:
        person = state["users"].get(uid) or state["tombstones"].get(uid, {}).get("record", {})
        targets = set(person.get("assignments", {}))
        targets.update(sid for sid, bindings in state["bindings"].items() if uid in bindings)
        for collection in ("retired_cards", "retired_pins"):
            targets.update(
                sid
                for item in state[collection].values()
                if item["user_id"] == uid
                for sid in item["targets"]
            )
        return targets

    def pending_revocations(self, state: dict[str, Any], uid: str) -> bool:
        return any(
            item["user_id"] == uid and set(item["targets"]) - set(item["confirmed"])
            for key in ("retired_cards", "retired_pins", "tombstones")
            for item in state[key].values()
        )

    async def transfer_start(
        self, actor: str, kind: str, source: str, target: str, revision: int, value: str
    ) -> dict[str, Any]:
        if kind not in {"card", "identity", "merge"}:
            raise AccessError("invalid_fields")
        identity = uuid4().hex
        affected: set[str] = set()

        def apply(state: dict[str, Any]) -> None:
            raw = state["users"].get(source)
            if not raw or raw["revision"] != revision:
                raise AccessError("revision_conflict")
            if any(
                item["source"] == source
                and item["state"] in {"awaiting_revocation", "awaiting_approval", "approved"}
                for item in state["workflows"]["transfers"].values()
            ):
                raise AccessError("transfer_in_progress")
            old = ManagedUser.from_private(raw)
            affected.update(self.targets(state, source))
            destination = state["users"].get(target) if target else None
            if kind in {"card", "merge"} and (not destination or source == target):
                raise AccessError("user_not_found")
            plan: dict[str, Any] = {}
            if kind == "card":
                card = next((card for card in old.cards if card.id == value), None)
                if card is None:
                    raise AccessError("card_not_found")
                plan = {
                    "card_no": card.card_no.value,
                    "enabled": card.enabled,
                    "label": card.label,
                    "card_type": card.card_type,
                }
                cards = [card.private() for card in old.cards if card.id != value]
                if not state["workflows"]["settings"]["dual_approval"]:
                    self.repository._update_user(state, source, {"cards": cards}, revision)
            else:
                from .encrypted_backup import desired

                plan = desired(old, {})
                if kind == "identity":
                    if (
                        not value
                        or any(p["employee_no"] == value for p in state["users"].values())
                        or any(
                            t["record"]["employee_no"] == value
                            for t in state["tombstones"].values()
                        )
                    ):
                        raise AccessError("employee_no_conflict")
                    # Validate the new identity before retiring the old one.
                    from .models import build_user

                    plan["employee_no"] = value
                    build_user(
                        self.repository.permission_data(plan), employee_no=value, now=utc_now()
                    )
                if not state["workflows"]["settings"]["dual_approval"]:
                    self.repository._delete_user(state, source, revision)
            _reserve(state["workflows"]["transfers"])
            state["workflows"]["transfers"][identity] = {
                "id": identity,
                "actor": actor,
                "kind": kind,
                "source": source,
                "target": target,
                "source_name": old.display_name,
                "target_revision": destination["revision"] if destination else None,
                "state": "awaiting_approval"
                if state["workflows"]["settings"]["dual_approval"]
                else "awaiting_revocation",
                "source_revision": revision,
                "source_card": value if kind == "card" else None,
                "approved_by": None,
                "plan": plan,
                "created_at": utc_now(),
            }

        await self.repository._commit(apply)
        for sid in affected:
            if sid in self.manager.stations:
                self.manager.request(sid)
        self.manager._changed()
        return next(item for item in self.transfers() if item["id"] == identity)

    def transfers(self) -> list[dict[str, Any]]:
        return [
            {
                key: item[key]
                for key in (
                    "id",
                    "actor",
                    "kind",
                    "source",
                    "source_name",
                    "target",
                    "state",
                    "created_at",
                    "approved_by",
                )
            }
            | {
                "ready": item["state"] == "awaiting_revocation"
                and not self.pending_revocations(self.repository._state, item["source"])
            }
            for item in self.data["transfers"].values()
        ]

    async def transfer_review(self, actor: str, identity: str, approve: bool) -> dict[str, Any]:
        def apply(state: dict[str, Any]) -> None:
            item = state["workflows"]["transfers"].get(identity)
            if not item or item["state"] not in {"awaiting_approval", "awaiting_revocation"}:
                raise AccessError("operation_not_found")
            if item["actor"] == actor:
                raise AccessError("separate_approver_required")
            if not approve:
                item.update(state="cancelled", plan={})
            else:
                item["approved_by"] = actor
                if item["state"] == "awaiting_approval":
                    item["state"] = "approved"

        await self.repository._commit(apply)
        self.manager._changed()
        return {"saved": True}

    async def transfer_begin(self, actor: str, identity: str) -> dict[str, Any]:
        affected: set[str] = set()

        def apply(state: dict[str, Any]) -> None:
            item = state["workflows"]["transfers"].get(identity)
            if not item or item["actor"] != actor or item["state"] != "approved":
                raise AccessError("operation_not_found")
            if not item["approved_by"] or item["approved_by"] == actor:
                raise AccessError("approval_required")
            source = item["source"]
            person = ManagedUser.from_private(state["users"][source])
            if person.revision != item["source_revision"]:
                raise AccessError("revision_conflict")
            affected.update(self.targets(state, source))
            if item["kind"] == "card":
                self.repository._update_user(
                    state,
                    source,
                    {
                        "cards": [
                            card.private()
                            for card in person.cards
                            if card.id != item["source_card"]
                        ]
                    },
                    person.revision,
                )
            else:
                self.repository._delete_user(state, source, person.revision)
            item["state"] = "awaiting_revocation"

        await self.repository._commit(apply)
        for sid in affected:
            if sid in self.manager.stations:
                self.manager.request(sid)
        self.manager._changed()
        return {"saved": True}

    async def transfer_recheck(self, actor: str, identity: str) -> dict[str, Any]:
        # A changed destination requires explicit review and a new second approval.
        def apply(state: dict[str, Any]) -> None:
            item = state["workflows"]["transfers"].get(identity)
            if not item or item["actor"] != actor or item["state"] != "awaiting_revocation":
                raise AccessError("operation_not_found")
            if item["kind"] != "identity":
                target = state["users"].get(item["target"])
                if not target:
                    raise AccessError("user_not_found")
                item["target_revision"] = target["revision"]
            item["approved_by"] = None

        await self.repository._commit(apply)
        return {"reviewed": True}

    async def transfer_finish(
        self, actor: str, identity: str, cancel: bool = False
    ) -> dict[str, Any]:
        affected: set[str] = set()

        def apply(state: dict[str, Any]) -> dict[str, Any]:
            item = state["workflows"]["transfers"].get(identity)
            if not item or item["actor"] != actor:
                raise AccessError("operation_not_found")
            if item["state"] == "completed":
                return {"completed": True}
            if item["state"] not in {"awaiting_revocation", "awaiting_approval", "approved"}:
                raise AccessError("transfer_finished")
            if cancel:
                item.update(state="cancelled", plan={})
                return {"cancelled": True}
            if item["state"] != "awaiting_revocation":
                raise AccessError("approval_required")
            if state["workflows"]["settings"]["dual_approval"] and (
                not item["approved_by"] or item["approved_by"] == actor
            ):
                raise AccessError("approval_required")
            if self.pending_revocations(state, item["source"]):
                raise AccessError("revocation_not_confirmed")
            if item["kind"] == "identity":
                user = self.repository._bulk_users(
                    state, [{"user_id": None, "revision": None, "data": item["plan"]}]
                )[0]
            else:
                target = ManagedUser.from_private(state["users"][item["target"]])
                if target.revision != item["target_revision"]:
                    raise AccessError("revision_conflict")
                data: dict[str, Any] = {"cards": [card.private() for card in target.cards]}
                if item["kind"] == "card":
                    data["cards"].append(item["plan"])
                else:
                    # Target identity/access stays authoritative. Only empty metadata and
                    # retired credentials merge; never union schedules or door permissions.
                    plan = item["plan"]
                    data["cards"] += plan["cards"]
                    if target.pin is None:
                        data["pin"] = plan["pin"]
                    for key in ("phone", "photo", "responsible_person", "access_purpose"):
                        if not getattr(target, key) and plan[key]:
                            data[key] = plan[key]
                user = self.repository._update_user(state, target.id, data, target.revision)
            validate_csv_targets(user, self.manager._csv_rules())
            affected.update(user.assignments)
            item.update(state="completed", plan={})
            return {"completed": True, "user_id": user.id}

        result = await self.repository._commit(apply)
        for sid in affected:
            if sid in self.manager.stations:
                self.manager.request(sid)
        self.manager._changed()
        return result

    def inventory(self) -> list[dict[str, Any]]:
        owners = {
            card.card_no.value: user for user in self.repository.users() for card in user.cards
        }
        rows = []
        for identity, item in self.data["inventory"].items():
            owner = owners.get(item["card_no"])
            rows.append(
                {
                    "id": identity,
                    "label": item["label"],
                    "status": item["status"],
                    "masked_number": "•••• " + item["card_no"][-4:],
                    "holder": owner.display_name if owner else None,
                    "holder_id": owner.id if owner else None,
                    "return_by": item["return_by"],
                    "revision": item["revision"],
                }
            )
        return rows

    async def inventory_save(
        self, identity: str, revision: int, values: dict[str, Any]
    ) -> dict[str, Any]:
        from ..client.access import validate_card
        from .models import text_field

        if set(values) != {"card_no", "label", "status", "return_by"}:
            raise AccessError("invalid_fields")
        if values["status"] not in {"available", "temporary", "lost", "blocked"}:
            raise AccessError("invalid_fields")
        old_item = self.data["inventory"].get(identity)
        number = validate_card(values["card_no"] or (old_item["card_no"] if old_item else ""))
        label = text_field(values["label"], 64)
        due = values["return_by"]
        if due is not None:
            instant = datetime.fromisoformat(due)
            if instant.tzinfo is None:
                raise AccessError("invalid_validity")
        identity = identity or uuid4().hex
        affected: set[str] = set()

        def apply(state: dict[str, Any]) -> None:
            items = state["workflows"]["inventory"]
            old = items.get(identity)
            if type(revision) is not int or revision != (old["revision"] if old else 0):
                raise AccessError("revision_conflict")
            if any(key != identity and item["card_no"] == number for key, item in items.items()):
                raise AccessError("card_conflict")
            if old and old["card_no"] != number:
                raise AccessError("identity_migration_required")
            if not old:
                _reserve(items)
            # Marking a card lost/blocked is an actual revocation, not merely a label.
            for user_id, raw in list(state["users"].items()):
                user = ManagedUser.from_private(raw)
                if any(card.card_no.value == number for card in user.cards):
                    if values["status"] == "available":
                        raise AccessError("card_still_assigned")
                    if values["status"] in {"lost", "blocked"}:
                        affected.update(self.targets(state, user_id))
                        self.repository._update_user(
                            state,
                            user_id,
                            {
                                "cards": [
                                    card.private()
                                    for card in user.cards
                                    if card.card_no.value != number
                                ]
                            },
                            user.revision,
                        )
            items[identity] = {
                "card_no": number,
                "label": label,
                "status": values["status"],
                "return_by": due,
                "revision": revision + 1,
            }

        await self.repository._commit(apply)
        for sid in affected:
            if sid in self.manager.stations:
                self.manager.request(sid)
        self.manager._changed()
        return next(item for item in self.inventory() if item["id"] == identity)

    async def inventory_issue(self, identity: str, user_id: str, revision: int) -> dict[str, Any]:
        def apply(state: dict[str, Any]) -> str:
            item = state["workflows"]["inventory"].get(identity)
            if not item or item["status"] not in {"available", "temporary"}:
                raise AccessError("card_unavailable")
            raw = state["users"].get(user_id)
            if not raw or raw["revision"] != revision:
                raise AccessError("revision_conflict")
            user = ManagedUser.from_private(raw)
            data = {
                "cards": [card.private() for card in user.cards]
                + [{"card_no": item["card_no"], "label": item["label"], "enabled": True}]
            }
            updated = self.repository._update_user(state, user_id, data, revision)
            validate_csv_targets(updated, self.manager._csv_rules())
            item["status"] = "temporary"
            item["revision"] += 1
            return updated.id

        uid = await self.repository._commit(apply)
        self.manager.request_user(uid)
        self.manager._changed()
        return {"issued": True}

    async def inventory_return(
        self, identity: str, revision: int, delete: bool = False
    ) -> dict[str, Any]:
        affected: set[str] = set()

        def apply(state: dict[str, Any]) -> None:
            items = state["workflows"]["inventory"]
            item = items.get(identity)
            if not item or item["revision"] != revision:
                raise AccessError("revision_conflict")
            holders = [
                ManagedUser.from_private(raw)
                for raw in state["users"].values()
                if any(card["card_no"] == item["card_no"] for card in raw["cards"])
            ]
            if delete:
                if holders or any(
                    r["card_no"] == item["card_no"] for r in state["retired_cards"].values()
                ):
                    raise AccessError("card_still_assigned")
                del items[identity]
                return
            for person in holders:
                affected.update(self.targets(state, person.id))
                self.repository._update_user(
                    state,
                    person.id,
                    {
                        "cards": [
                            card.private()
                            for card in person.cards
                            if card.card_no.value != item["card_no"]
                        ]
                    },
                    person.revision,
                )
            item.update(status="available", return_by=None, revision=revision + 1)

        await self.repository._commit(apply)
        for sid in affected:
            if sid in self.manager.stations:
                self.manager.request(sid)
        self.manager._changed()
        return {"saved": True}

    async def template_save(
        self, identity: str, revision: int, values: dict[str, Any]
    ) -> dict[str, Any]:
        from .models import build_user, text_field

        if set(values) != {"label", "data", "message"} or not isinstance(values["data"], dict):
            raise AccessError("invalid_fields")
        if set(values["data"]) - {
            "profile",
            "group_ids",
            "permission_overrides",
            "assignments",
            "access_timing_policy",
            "valid_from",
            "valid_until",
        }:
            raise AccessError("invalid_fields")
        label = text_field(values["label"], 80)
        if not isinstance(values["message"], str) or len(values["message"]) > 4000:
            raise AccessError("invalid_fields")
        data = deepcopy(values["data"])
        timing = data.get("access_timing_policy")
        if timing and timing.get("mode") != "ha":
            raise AccessError("template_native_binding_unsupported")
        if "assignments" in data and data.get("group_ids"):
            grants = self.repository.permission_data({"group_ids": data["group_ids"]})[
                "assignments"
            ]
            for sid, assignment in grants.items():
                data["assignments"].setdefault(sid, assignment)
        user = build_user(
            self.repository.permission_data({"display_name": "Template", **data}),
            employee_no="99999999",
            now=utc_now(),
        )
        validate_csv_targets(user, self.manager._csv_rules())
        identity = identity or uuid4().hex

        def apply(state: dict[str, Any]) -> None:
            items = state["workflows"]["templates"]
            old = items.get(identity)
            if type(revision) is not int or revision != (old["revision"] if old else 0):
                raise AccessError("revision_conflict")
            if not old:
                _reserve(items, 64)
            items[identity] = {
                "id": identity,
                "revision": revision + 1,
                "label": label,
                "data": data,
                "message": values["message"],
            }

        await self.repository._commit(apply)
        return deepcopy(self.data["templates"][identity])

    async def template_delete(self, identity: str, revision: int) -> dict[str, bool]:
        def apply(state: dict[str, Any]) -> None:
            item = state["workflows"]["templates"].get(identity)
            if not item or item["revision"] != revision:
                raise AccessError("revision_conflict")
            del state["workflows"]["templates"][identity]

        await self.repository._commit(apply)
        return {"deleted": True}

    def reminders(self, days: int = 7) -> list[dict[str, Any]]:
        if type(days) is not int or not 1 <= days <= 365:
            raise AccessError("invalid_fields")
        now = datetime.now(UTC)
        rows: list[dict[str, Any]] = []
        for user in self.repository.users():
            if not user.active:
                continue
            for kind, value in (("starts", user.valid_from), ("expires", user.valid_until)):
                if value is None:
                    continue
                instant = datetime.fromisoformat(value).astimezone(UTC)
                if not now <= instant <= now + timedelta(days=days):
                    continue
                identity = f"{user.id}:{user.revision}:{kind}"
                mark = self.data["reminders"].get(identity)
                if mark and mark["state"] == "acknowledged":
                    continue
                if mark and mark["until"] and datetime.fromisoformat(mark["until"]) > now:
                    continue
                rows.append(
                    {
                        "id": identity,
                        "user_id": user.id,
                        "name": user.display_name,
                        "kind": kind,
                        "at": value,
                        "phone": user.phone,
                        "revision": user.revision,
                    }
                )
        return sorted(rows, key=lambda row: row["at"])[:200]

    async def reminder_action(self, actor: str, identity: str, action: str) -> dict[str, bool]:
        if action not in {"acknowledge", "snooze"} or not actor:
            raise AccessError("invalid_fields")
        if not any(row["id"] == identity for row in self.reminders(365)):
            raise AccessError("revision_conflict")

        def apply(state: dict[str, Any]) -> None:
            records = state["workflows"]["reminders"]
            if len(records) >= 2000:
                oldest = min(records, key=lambda key: records[key]["at"])
                del records[oldest]
            records[identity] = {
                "state": "acknowledged" if action == "acknowledge" else "snoozed",
                "actor": actor,
                "at": utc_now(),
                "until": (datetime.now(UTC) + timedelta(days=1)).isoformat()
                if action == "snooze"
                else None,
            }

        await self.repository._commit(apply)
        return {"saved": True}

    async def renewal_request(
        self, actor: str, user_id: str, revision: int, until: str, reason: str
    ) -> dict[str, Any]:
        from .models import text_field, valid_period

        user = self.repository.get(user_id)
        if user.revision != revision or not user.valid_from or not user.valid_until:
            raise AccessError("invalid_validity")
        start, end = valid_period(user.valid_from, until)
        if end is None or datetime.fromisoformat(end) <= datetime.fromisoformat(user.valid_until):
            raise AccessError("invalid_validity")
        reason = text_field(reason, 240)
        identity = uuid4().hex

        def apply(state: dict[str, Any]) -> None:
            if state["users"][user_id]["revision"] != revision:
                raise AccessError("revision_conflict")
            requests = state["workflows"]["renewals"]
            _reserve(requests)
            if any(
                item["user_id"] == user_id and item["state"] == "pending"
                for item in requests.values()
            ):
                raise AccessError("renewal_already_pending")
            requests[identity] = {
                "id": identity,
                "actor": actor,
                "user_id": user_id,
                "revision": revision,
                "until": end,
                "reason": reason,
                "state": "pending",
                "created_at": utc_now(),
                "approver": None,
            }

        await self.repository._commit(apply)
        return {"id": identity, "state": "pending"}

    async def renewal_decide(
        self,
        actor: str,
        identity: str,
        approve: bool,
        *,
        owner_active: bool = False,
        reviewer_active: bool = False,
    ) -> dict[str, Any]:
        affected: set[str] = set()

        def apply(state: dict[str, Any]) -> bool:
            item = state["workflows"]["renewals"].get(identity)
            if not item or item["state"] != "pending":
                raise AccessError("operation_not_found")
            if item["actor"] == actor:
                raise AccessError("separate_approver_required")
            if datetime.fromisoformat(item["created_at"]) + timedelta(days=7) < datetime.now(UTC):
                raise AccessError("approval_expired")
            if approve:
                if "binding" in item:
                    if not owner_active:
                        raise AccessError("renewal_identity_inactive")
                    renewal_identity.recheck(
                        state["workflows"]["renewal_identity"], item["binding"]
                    )
                    from .bulk_operations import renewal_patch

                    raw = state["users"].get(item["user_id"])
                    if not raw or raw.get("archived_at"):
                        raise AccessError("renewal_person_unavailable")
                    current = ManagedUser.from_private(raw)
                    if not current.active:
                        raise AccessError("renewal_person_unavailable")
                    renewal_patch(current, item["until"])
                    if current.revision != item["revision"]:
                        raise AccessError("revision_conflict")
                    if state["workflows"]["settings"]["dual_approval"]:
                        if item.get("reviewer") is None:
                            item["reviewer"] = actor
                            return True
                        if item["reviewer"] == actor:
                            raise AccessError("separate_approver_required")
                        if not reviewer_active:
                            raise AccessError("renewal_approver_inactive")
                user = self.repository._update_user(
                    state, item["user_id"], {"valid_until": item["until"]}, item["revision"]
                )
                validate_csv_targets(user, self.manager._csv_rules())
                affected.update(user.assignments)
            item.update(state="approved" if approve else "rejected", approver=actor)
            return False

        awaiting_second = await self.repository._commit(apply)
        for sid in affected:
            if sid in self.manager.stations:
                self.manager.request(sid)
        self.manager._changed()
        return {"saved": True, **({"awaiting_second_approver": True} if awaiting_second else {})}
