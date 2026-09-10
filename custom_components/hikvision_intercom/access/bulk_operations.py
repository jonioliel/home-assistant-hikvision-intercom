"""Explicit, reviewed bulk operations over the existing desired-state reconciler."""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from copy import deepcopy
from dataclasses import asdict
from time import monotonic
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from .admin_audit import audit_actor
from .csv_transfer import desired_fields, validate_csv_targets
from .models import AccessError, build_user, text_field, utc_now

if TYPE_CHECKING:
    from .manager import AccessManager

ACTIONS = frozenset(
    {"enable", "disable", "assign", "unassign", "delete", "remove_pin", "remove_cards", "sync"}
)


def selection(request: dict[str, Any]) -> list[dict[str, Any]]:
    if (
        not isinstance(request, dict)
        or set(request) - {"action", "selection", "station_id"}
        or not isinstance(request.get("action"), str)
        or request.get("action") not in ACTIONS
    ):
        raise AccessError("invalid_fields")
    selected = request.get("selection")
    if not isinstance(selected, list) or not 1 <= len(selected) <= 200:
        raise AccessError("bulk_selection_invalid")
    seen = set()
    for item in selected:
        if not isinstance(item, dict) or set(item) != {"user_id", "revision"}:
            raise AccessError("bulk_selection_invalid")
        text_field(item["user_id"], 128)
        if item["user_id"] in seen or type(item["revision"]) is not int or item["revision"] < 1:
            raise AccessError("bulk_selection_invalid")
        seen.add(item["user_id"])
    if request["action"] in {"assign", "unassign"}:
        text_field(request.get("station_id"), 128)
    elif "station_id" in request:
        raise AccessError("invalid_fields")
    return selected


class BulkOperations:
    def __init__(self, manager: AccessManager) -> None:
        self.manager = manager
        self.reviews: OrderedDict[str, dict[str, Any]] = OrderedDict()

    def rules_stamp(self) -> str:
        return self.manager.repository.fingerprint(
            {
                sid: [
                    *rule[:3],
                    {
                        key: sorted(value) if isinstance(value, frozenset) else value
                        for key, value in asdict(rule[3]).items()
                    }
                    if rule[3]
                    else None,
                ]
                for sid, rule in self.manager._csv_rules().items()
            }
        )

    def _purge(self) -> None:
        for key, review in list(self.reviews.items()):
            if review["deadline"] <= monotonic():
                del self.reviews[key]

    async def preview(self, actor: str, request: dict[str, Any]) -> dict[str, Any]:
        text_field(actor, 128)
        selected = selection(request)
        self._purge()
        repository = self.manager.repository.preview_copy()
        rules = self.manager._csv_rules()
        captured_rules = self.rules_stamp()
        action = request["action"]
        if action in {"assign", "unassign"} and request["station_id"] not in rules:
            raise AccessError("station_not_found")
        # Snapshot inventory for estimates only. Actual writes always recheck capacity.
        inventory = {
            sid: (deepcopy(station.inventory), station.scanned_at)
            for sid, station in self.manager.stations.items()
        }

        def plan() -> dict[str, Any]:
            state = repository.snapshot()
            changes, rows = [], []
            targets: set[str] = set()
            capacity: dict[str, dict[str, Any]] = {}
            for sid, (observed, checked) in inventory.items():
                caps = rules[sid][3]
                capacity[sid] = {
                    "station_id": sid,
                    "checked_at": checked,
                    "source": "cached_inventory" if observed else "unavailable",
                    "users_now": len(observed.users) if observed else None,
                    "cards_now": len(observed.cards) if observed else None,
                    "max_users": caps.max_users if caps else None,
                    "max_cards": caps.max_cards if caps else None,
                    "users_added": 0,
                    "users_removed": 0,
                    "cards_added": 0,
                    "cards_removed": 0,
                }
            for item in selected:
                old = repository.get(item["user_id"])
                if old.revision != item["revision"]:
                    raise AccessError("revision_conflict")
                data: dict[str, Any] = {}
                if action in {"enable", "disable"}:
                    data = {"active": action == "enable"}
                elif action in {"assign", "unassign"}:
                    assignments = {
                        sid: {
                            "enabled": a.enabled,
                            "allowed_locks": sorted(a.allowed_locks),
                            "schedule_template": a.schedule_template,
                        }
                        for sid, a in old.assignments.items()
                    }
                    if action == "assign":
                        existing = assignments.get(request["station_id"])
                        assignments[request["station_id"]] = {
                            **(existing or {"allowed_locks": [1], "schedule_template": None}),
                            "enabled": True,
                        }
                    else:
                        assignments.pop(request["station_id"], None)
                    data = {"assignments": assignments}
                elif action == "remove_pin":
                    data = {"pin": None}
                elif action == "remove_cards":
                    data = {"cards": []}
                new = (
                    None
                    if action == "delete"
                    else build_user(
                        repository.permission_data(data, old, state=state),
                        employee_no=old.employee_no,
                        now=utc_now(),
                        previous=old,
                    )
                )
                fields = (
                    sorted(desired_fields(old))
                    if new is None
                    else [
                        key
                        for key, value in desired_fields(old).items()
                        if value != desired_fields(new)[key]
                    ]
                )
                if fields:
                    if new:
                        validate_csv_targets(new, rules)
                        repository._update_user(state, old.id, data, old.revision)
                    else:
                        repository._delete_user(state, old.id, old.revision)
                    changes.append(
                        {
                            "user_id": old.id,
                            "revision": old.revision,
                            "delete": new is None,
                            "data": data,
                        }
                    )
                affected = (
                    set(old.assignments)
                    | (set(new.assignments) if new else set())
                    | {sid for sid, bindings in state["bindings"].items() if old.id in bindings}
                )
                for collection in ("retired_pins", "retired_cards"):
                    affected.update(
                        sid
                        for retired in state[collection].values()
                        if retired["user_id"] == old.id
                        for sid in retired["targets"]
                    )
                targets.update(affected)
                rows.append(
                    {
                        "user_id": old.id,
                        "display_name": old.display_name,
                        "employee_no": old.employee_no,
                        "revision": old.revision,
                        "changed_fields": fields,
                        "changed": bool(fields),
                        "stations": sorted(affected),
                        "pin_before": old.pin is not None,
                        "pin_after": new.pin is not None if new else False,
                        "cards_before": len(old.cards),
                        "cards_after": len(new.cards) if new else 0,
                        "active_before": old.active,
                        "active_after": new.active if new else False,
                    }
                )
                if action == "sync":
                    continue
                for sid in affected.intersection(inventory):
                    observed = inventory[sid][0]
                    if observed is None:
                        continue
                    present = old.employee_no in observed.users
                    wanted = bool(
                        new
                        and new.active
                        and sid in new.assignments
                        and new.assignments[sid].enabled
                    )
                    old_numbers = {
                        c["cardNo"]
                        for c in observed.cards.values()
                        if c.get("employeeNo") == old.employee_no
                    }
                    new_numbers = (
                        {c.card_no.value for c in new.cards if c.enabled}
                        if new and wanted
                        else set()
                    )
                    estimate = capacity[sid]
                    estimate["users_added"] += int(wanted and not present)
                    estimate["users_removed"] += int(present and not wanted)
                    estimate["cards_added"] += len(new_numbers - old_numbers)
                    estimate["cards_removed"] += len(old_numbers - new_numbers)
            repository._validate_collisions(state)
            estimates = [capacity[sid] for sid in sorted(targets.intersection(capacity))]
            for estimate in estimates:
                for kind in ("users", "cards"):
                    count = estimate[kind + "_now"]
                    estimate[kind + "_projected"] = (
                        count + estimate[kind + "_added"] - estimate[kind + "_removed"]
                        if count is not None
                        else None
                    )
                    estimate[kind + "_peak"] = (
                        count + estimate[kind + "_added"] if count is not None else None
                    )
                estimate["capacity_warning"] = any(
                    estimate[kind + "_peak"] is not None
                    and estimate["max_" + kind] is not None
                    and estimate[kind + "_peak"] > estimate["max_" + kind]
                    for kind in ("users", "cards")
                )
            return {
                "changes": changes,
                "rows": rows,
                "capacity": estimates,
                "stations": sorted(targets),
                "stamp": repository.bulk_stamp(),
            }

        result = await asyncio.to_thread(plan)
        if (
            self.manager._closed
            or captured_rules != self.rules_stamp()
            or result["stamp"] != self.manager.repository.bulk_stamp()
        ):
            raise AccessError("bulk_review_stale")
        operation_id = uuid4().hex
        for key in [key for key, item in self.reviews.items() if item["actor"] == actor][:-4]:
            del self.reviews[key]
        while len(self.reviews) >= 100:
            self.reviews.popitem(last=False)
        self.reviews[operation_id] = {
            **result,
            "actor": actor,
            "action": action,
            "rules": captured_rules,
            "deadline": monotonic() + 300,
        }
        return {
            "operation_id": operation_id,
            "action": action,
            "expires_in": 300,
            "rows": result["rows"],
            "capacity": result["capacity"],
            "selected": len(selected),
            "changed": len(result["changes"]),
            "stations": result["stations"],
            "device_writes": 0,
        }

    def receipts(self, actor: str) -> list[dict[str, Any]]:
        return sorted(
            (
                deepcopy(r)
                for r in self.manager.repository._state["operation_receipts"].values()
                if r["actor"] == actor
            ),
            key=lambda r: (r["saved_at"], r["operation_id"]),
            reverse=True,
        )[:50]

    def receipt(self, actor: str, operation_id: str) -> dict[str, Any]:
        receipt: dict[str, Any] | None = self.manager.repository._state["operation_receipts"].get(
            operation_id
        )
        if not receipt or receipt["actor"] != actor:
            raise AccessError("operation_not_found")
        return deepcopy(receipt)

    async def apply(self, actor: str, operation_id: str) -> dict[str, Any]:
        text_field(actor, 128)
        text_field(operation_id, 128)
        if self.manager._closed:
            raise AccessError("manager_closed")
        try:
            existing = self.receipt(actor, operation_id)
        except AccessError:
            existing = None
        if existing:
            for sid in set(existing["stations"]).intersection(self.manager.stations):
                self.manager.request(sid)
            return existing
        self._purge()
        review = self.reviews.get(operation_id)
        if not review or review["actor"] != actor:
            raise AccessError("bulk_review_expired")
        if review["rules"] != self.rules_stamp():
            raise AccessError("bulk_review_stale")
        rules = self.manager._csv_rules()
        receipt = {
            "operation_id": operation_id,
            "actor": actor,
            "action": "bulk/" + review["action"],
            "saved_at": utc_now(),
            "user_ids": [row["user_id"] for row in review["rows"]],
            "changed": len(review["changes"]),
            "stations": review["stations"],
        }
        with audit_actor(actor, receipt["action"]):
            result = await self.manager.repository.async_apply_operation(
                review["changes"],
                stamp=review["stamp"],
                receipt=receipt,
                validate=lambda user: validate_csv_targets(user, rules),
            )
        self.reviews.pop(operation_id, None)
        for sid in set(result["stations"]).intersection(self.manager.stations):
            self.manager.request(sid)
        self.manager._changed()
        return result
