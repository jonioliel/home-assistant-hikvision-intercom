"""Account-bound personal renewal requests, saved with central desired state."""

from __future__ import annotations

import hashlib
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from . import renewal_identity
from .bulk_operations import renewal_patch
from .models import AccessError, ManagedUser, text_field, utc_now
from .workflows import _reserve

if TYPE_CHECKING:
    from .workflows import Workflows


def personal_account(user: Any) -> bool:
    return bool(user and user.is_active and not getattr(user, "system_generated", False))


def _public(item: dict[str, Any]) -> dict[str, Any]:
    return {key: deepcopy(item[key]) for key in ("id", "until", "reason", "state", "created_at")}


class RenewalPortal:
    def __init__(self, center: Workflows) -> None:
        self.center = center
        self.repository = center.repository

    def linked(self, actor: str) -> bool:
        return actor in self.center.data["renewal_identity"]["bindings"]

    def own(self, actor: str) -> dict[str, Any]:
        try:
            proof = renewal_identity.resolve(self.center.data["renewal_identity"], actor)
        except AccessError as err:
            if err.code == "renewal_identity_unlinked":
                return {"linked": False}
            raise
        person = self.repository._state["users"].get(proof["user_id"])
        if not person or person.get("archived_at"):
            return {"linked": False}
        user = ManagedUser.from_private(person)
        requests = []
        for item in self.center.data["renewals"].values():
            if item.get("binding") != proof:
                continue
            row = _public(item)
            if row["state"] == "pending":
                if item["revision"] != user.revision or not user.active:
                    row["state"] = "stale"
                elif datetime.fromisoformat(item["created_at"]) + timedelta(days=7) < datetime.now(
                    UTC
                ):
                    row["state"] = "expired"
            requests.append(row)
        return {
            "linked": True,
            "name": user.display_name,
            "revision": user.revision,
            "active": user.active,
            "valid_from": user.valid_from,
            "valid_until": user.valid_until,
            "can_request": bool(user.active and user.valid_from and user.valid_until),
            "requests": sorted(requests, key=lambda row: row["created_at"], reverse=True)[:20],
        }

    def bindings(self) -> dict[str, Any]:
        identity = renewal_identity.checked(self.center.data["renewal_identity"])
        return {
            "revision": identity["revision"],
            "bindings": {
                account: {
                    "user_id": row["user_id"],
                    "name": self.repository._state["users"]
                    .get(row["user_id"], {})
                    .get("display_name", ""),
                    "available": bool(
                        row["user_id"] in self.repository._state["users"]
                        and not self.repository._state["users"][row["user_id"]].get("archived_at")
                    ),
                }
                for account, row in identity["bindings"].items()
            },
        }

    async def bind(
        self, account: str, user_id: str | None, revision: int, confirmed: bool
    ) -> dict[str, Any]:
        if confirmed is not True:
            raise AccessError("confirmation_required")

        def apply(state: dict[str, Any]) -> None:
            if user_id is not None:
                raw = state["users"].get(user_id)
                if not raw or raw.get("archived_at"):
                    raise AccessError("renewal_person_unavailable")
            journal = state["workflows"]
            before = journal["renewal_identity"]
            after = renewal_identity.plan_binding(before, revision, account, user_id)
            if after == before:
                return
            journal["renewal_identity"] = after
            for item in journal["renewals"].values():
                if item.get("binding", {}).get("actor") == account and item["state"] == "pending":
                    item["state"] = "cancelled"

        await self.repository._commit(apply)
        self.center.manager._changed()
        return self.bindings()

    async def request(
        self, actor: str, revision: int, until: str, reason: str, request_key: str
    ) -> dict[str, Any]:
        key = text_field(request_key, 64)
        if key != request_key or len(key) < 16:
            raise AccessError("invalid_fields")
        reason = text_field(reason, 240)
        try:
            end_time = datetime.fromisoformat(text_field(until, 64))
            if end_time.tzinfo is None:
                raise ValueError
        except (ValueError, TypeError):
            raise AccessError("invalid_validity") from None
        identity = hashlib.sha256(f"{actor}:{key}".encode()).hexdigest()

        def apply(state: dict[str, Any]) -> dict[str, Any]:
            journal = state["workflows"]
            proof = renewal_identity.resolve(journal["renewal_identity"], actor)
            raw = state["users"].get(proof["user_id"])
            if not raw or raw.get("archived_at") or not raw.get("active"):
                raise AccessError("renewal_person_unavailable")
            person = ManagedUser.from_private(raw)
            previous = journal["renewals"].get(identity)
            if previous:
                if (
                    previous.get("binding") != proof
                    or previous.get("request_key") != key
                    or previous["reason"] != reason
                    or type(revision) is not int
                    or previous["revision"] != revision
                    or datetime.fromisoformat(previous["until"]) != end_time
                ):
                    raise AccessError("renewal_request_changed")
                return _public(previous)
            if type(revision) is not int or person.revision != revision:
                raise AccessError("revision_conflict")
            end = renewal_patch(person, until)["valid_until"]
            requests = journal["renewals"]
            if any(
                item["user_id"] == person.id and item["state"] == "pending"
                for item in requests.values()
            ):
                raise AccessError("renewal_already_pending")
            _reserve(requests)
            requests[identity] = {
                "id": identity,
                "actor": actor,
                "user_id": person.id,
                "revision": revision,
                "until": end,
                "reason": reason,
                "state": "pending",
                "created_at": utc_now(),
                "approver": None,
                "binding": proof,
                "request_key": key,
                "reviewer": None,
            }
            return _public(requests[identity])

        result = await self.repository._commit(apply)
        self.center.manager._changed()
        return result

    async def cancel(self, actor: str, identity: str) -> dict[str, Any]:
        def apply(state: dict[str, Any]) -> dict[str, Any]:
            proof = renewal_identity.resolve(state["workflows"]["renewal_identity"], actor)
            item = state["workflows"]["renewals"].get(identity)
            if not item or item.get("binding") != proof:
                raise AccessError("operation_not_found")
            if item["state"] == "cancelled":
                return _public(item)
            if item["state"] != "pending":
                raise AccessError("operation_not_found")
            item["state"] = "cancelled"
            return _public(item)

        result = await self.repository._commit(apply)
        self.center.manager._changed()
        return result
