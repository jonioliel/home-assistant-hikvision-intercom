"""Revision-bound group policy impact reviews, saved atomically with durable receipts."""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from copy import deepcopy
from time import monotonic
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from ..profile_settings import ProfileSettings
from .admin_audit import audit_actor
from .csv_transfer import desired_fields, validate_csv_targets
from .models import AccessError, ManagedUser, build_user, text_field, utc_now

if TYPE_CHECKING:
    from .manager import AccessManager


class PolicyOperations:
    def __init__(self, manager: AccessManager) -> None:
        self.manager = manager
        self.reviews: OrderedDict[str, dict[str, Any]] = OrderedDict()

    async def preview(self, actor: str, revision: int, values: dict[str, Any]) -> dict[str, Any]:
        text_field(actor, 128)
        repo = self.manager.repository.preview_copy()
        stamp, rules_stamp = repo.bulk_stamp(), self.manager.bulk.rules_stamp()
        rules = self.manager._csv_rules()
        prior = repo.profile_settings()

        async def save(_: dict[str, Any]) -> None:
            pass

        candidate = ProfileSettings(save, lambda: None)
        candidate.load(prior)
        await candidate.update(revision, values)
        proposed = deepcopy(candidate.data)
        # Always issue a revision for the reviewed transaction, including no-op saves.
        proposed["revision"] = revision + 1
        old_groups = {g["id"]: g for g in (prior or {}).get("values", {}).get("groups", [])}
        changed_groups = set()
        for group in proposed["values"]["groups"]:
            old = old_groups.get(group["id"], {"enabled": True, "station_ids": []})
            if (group["enabled"], set(group.get("station_ids", []))) != (
                old["enabled"],
                set(old.get("station_ids", [])),
            ):
                changed_groups.add(group["id"])
            for sid in set(group.get("station_ids", [])) - set(old.get("station_ids", [])):
                if sid not in rules:
                    raise AccessError("station_not_found")
                if not self.manager.stations[sid].lock_enabled:
                    raise AccessError("unmanaged_lock")
        state = repo.snapshot()
        if len(state["users"]) > 10000:
            raise AccessError("bulk_selection_invalid")
        state["profile_settings"] = proposed

        def plan() -> dict[str, Any]:
            rows = []
            targets: set[str] = set()
            changed = 0
            for raw in state["users"].values():
                old = ManagedUser.from_private(raw)
                new = build_user(
                    repo.permission_data({}, old, state=state),
                    employee_no=old.employee_no,
                    previous=old,
                    now=utc_now(),
                )
                affects_access = desired_fields(old) != desired_fields(new)
                if affects_access:
                    validate_csv_targets(new, rules)
                    targets.update(set(old.assignments) | set(new.assignments))
                    changed += 1
                if changed_groups.intersection(old.group_ids):
                    rows.append(
                        {
                            "user_id": old.id,
                            "display_name": old.display_name,
                            "employee_no": old.employee_no,
                            "before": sorted(s for s, a in old.assignments.items() if a.enabled),
                            "after": sorted(s for s, a in new.assignments.items() if a.enabled),
                            "overrides": dict(old.permission_overrides),
                            "changed": affects_access,
                        }
                    )
            return {"rows": rows, "changed": changed, "stations": sorted(targets)}

        result = await asyncio.to_thread(plan)
        if (
            self.manager._closed
            or stamp != self.manager.repository.bulk_stamp()
            or rules_stamp != self.manager.bulk.rules_stamp()
        ):
            raise AccessError("bulk_review_stale")
        for key, item in list(self.reviews.items()):
            if item["deadline"] <= monotonic():
                del self.reviews[key]
        for key in [key for key, r in self.reviews.items() if r["actor"] == actor][:-4]:
            del self.reviews[key]
        while len(self.reviews) >= 100:
            self.reviews.popitem(last=False)
        op = uuid4().hex
        self.reviews[op] = {
            "actor": actor,
            "stamp": stamp,
            "rules": rules_stamp,
            "data": proposed,
            "deadline": monotonic() + 300,
            "stations": result["stations"],
        }
        return {
            **result,
            "operation_id": op,
            "requires_confirmation": bool(changed_groups),
            "expires_in": 300,
            "device_writes": 0,
            "offline": [
                sid
                for sid in result["stations"]
                if sid not in self.manager.stations
                or self.manager.stations[sid].driver is None
                or self.manager.stations[sid].status == "offline"
            ],
        }

    async def apply(self, actor: str, operation_id: str) -> dict[str, Any]:
        text_field(actor, 128)
        text_field(operation_id, 128)
        if self.manager._closed:
            raise AccessError("manager_closed")
        try:
            existing = self.manager.bulk.receipt(actor, operation_id)
        except AccessError:
            existing = None
        if existing:
            if existing["action"] != "bulk/group_policy":
                raise AccessError("operation_not_found")
            return existing
        review = self.reviews.get(operation_id)
        if not review or review["actor"] != actor or review["deadline"] <= monotonic():
            raise AccessError("bulk_review_expired")
        if review["rules"] != self.manager.bulk.rules_stamp():
            raise AccessError("bulk_review_stale")
        rules = self.manager._csv_rules()
        receipt = {
            "operation_id": operation_id,
            "actor": actor,
            "action": "bulk/group_policy",
            "saved_at": utc_now(),
            "stations": review["stations"],
            "user_ids": [],
            "changed": 0,
        }
        try:
            with audit_actor(actor, receipt["action"]):
                await self.manager.repository.async_profile_settings(
                    review["data"],
                    lambda user: validate_csv_targets(user, rules),
                    stamp=review["stamp"],
                    receipt=receipt,
                )
        finally:
            # A cancelled HTTP/WS request may still finish its shielded durable save.
            saved = self.manager.repository._state["operation_receipts"].get(operation_id)
            if saved:
                self.reviews.pop(operation_id, None)
                if not self.manager._closed:
                    for sid in set(saved["stations"]).intersection(self.manager.stations):
                        self.manager.request(sid)
                self.manager._changed()
        return self.manager.bulk.receipt(actor, operation_id)
