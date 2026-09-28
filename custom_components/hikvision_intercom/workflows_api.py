"""Explicit operator actions for backup, approvals, card lifecycle and staff presets."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from homeassistant.core import HomeAssistant

from .access.models import AccessError
from .access_runtime import get_manager
from .const import DOMAIN


async def dispatch_workflows(
    hass: HomeAssistant, command: str, msg: dict[str, Any], actor: str, user: Any
) -> Any:
    data = hass.data[DOMAIN]
    center = data["workflows"]
    manager = get_manager(hass)
    if command == "workflows/renew_request":
        # Permission and person/station scope are checked at the command boundary.
        return await center.renewal_request(
            actor, msg["user_id"], msg["revision"], msg["until"], msg["reason"]
        )
    if not user or not user.is_admin or not user.is_active:
        raise AccessError("unauthorized")
    if command == "backups/export":
        return await data["backups"].export(msg["passphrase"])
    if command == "backups/preview":
        return await data["backups"].preview(
            actor, msg["content"], msg["passphrase"], msg["mapping"], msg["mode"]
        )
    if command == "backups/apply":
        return await data["backups"].apply(actor, msg["review_id"], msg["confirmed"])
    if command == "workflows/get":
        return {
            "settings": center.settings(),
            "approvals": center.approvals(),
            "transfers": center.transfers(),
            "inventory": center.inventory(),
            "templates": deepcopy(list(center.data["templates"].values())),
            "reminders": center.reminders(msg["days"]),
            "renewals": [
                {**item, "name": manager.repository.get(item["user_id"]).display_name}
                for item in center.data["renewals"].values()
                if item["user_id"] in manager.repository._state["users"]
            ],
        }
    if command == "workflows/settings_update":
        # Avoid enabling a lock that the owner cannot unlock with their provider.
        if (msg["values"].get("idle_minutes") or msg["values"].get("reauth_sensitive")) and not any(
            item.auth_provider_type == "homeassistant" and not item.is_new
            for item in user.credentials
        ):
            raise AccessError("reauth_provider_unavailable")
        return await center.update_settings(msg["revision"], msg["values"])
    if command == "workflows/submit":
        original, values = msg["command"], msg["values"]
        effects = []
        if original == "users/bulk_apply":
            manager.bulk._purge()
            review = manager.bulk.reviews.get(values.get("operation_id"))
            if (
                not review
                or review["actor"] != actor
                or review["rules"] != manager.bulk.rules_stamp()
            ):
                raise AccessError("bulk_review_stale")
            changes, stamp = review["changes"], review["stamp"]
        elif original == "workflows/inventory_save":
            changes, effects = center.inventory_review(
                values["card_id"], values["revision"], values["values"]
            )
            stamp = manager.repository.bulk_stamp()
        elif original == "workflows/inventory_return":
            item = center.data["inventory"].get(values["card_id"])
            if not item or values.get("delete"):
                raise AccessError("approval_command_unsupported")
            cards = []
            changes = []
            for person in manager.repository.users():
                if any(card.card_no.value == item["card_no"] for card in person.cards):
                    changes.append(
                        {
                            "user_id": person.id,
                            "revision": person.revision,
                            "data": {
                                "cards": [
                                    card.private()
                                    for card in person.cards
                                    if card.card_no.value != item["card_no"]
                                ]
                            },
                        }
                    )
            effects = [
                {
                    "id": values["card_id"],
                    "revision": values["revision"],
                    "values": {
                        key: item[key] for key in ("card_no", "label", "status", "return_by")
                    },
                }
            ]
            effects[0]["values"].update(status="available", return_by=None)
            stamp = manager.repository.bulk_stamp()
        elif original == "users/create":
            from .websocket import _patch

            patch = _patch(values["data"])
            if not patch.get("employee_no"):
                from secrets import randbelow

                taken = {p.employee_no for p in manager.repository.users()} | {
                    p["record"]["employee_no"]
                    for p in manager.repository._state["tombstones"].values()
                }
                while (employee := str(100_000_000 + randbelow(900_000_000))) in taken:
                    pass
                patch["employee_no"] = employee
            changes = [{"user_id": None, "revision": None, "data": patch}]
            stamp = manager.repository.bulk_stamp()
        elif original in {"cards/add", "cards/remove", "workflows/inventory_issue"}:
            person = manager.repository.get(values["user_id"])
            if person.revision != values["revision"]:
                raise AccessError("revision_conflict")
            cards = [card.private() for card in person.cards]
            if original == "cards/add":
                from .websocket import CARD_FIELDS

                card = values["data"]
                if set(card) - CARD_FIELDS or "card_no" not in card or "id" in card:
                    raise AccessError("invalid_fields")
                cards.append(card)
            elif original == "cards/remove":
                if not any(card["id"] == values["card_id"] for card in cards):
                    raise AccessError("card_not_found")
                cards = [card for card in cards if card["id"] != values["card_id"]]
            else:
                card = center.data["inventory"].get(values["card_id"])
                if not card or card["status"] not in {"available", "temporary"}:
                    raise AccessError("card_unavailable")
                cards.append({"card_no": card["card_no"], "label": card["label"], "enabled": True})
                effects = [
                    {
                        "id": values["card_id"],
                        "revision": card["revision"],
                        "values": {
                            key: card[key] for key in ("card_no", "label", "status", "return_by")
                        },
                    }
                ]
                effects[0]["values"]["status"] = "temporary"
            changes = [
                {"user_id": person.id, "revision": person.revision, "data": {"cards": cards}}
            ]
            stamp = manager.repository.bulk_stamp()
        elif original in {"users/update", "users/delete", "users/set_active"}:
            person = manager.repository.get(values["user_id"])
            if person.revision != values["revision"]:
                raise AccessError("revision_conflict")
            changes = [
                {
                    "user_id": person.id,
                    "revision": person.revision,
                    "data": _clean_patch(values["data"])
                    if original == "users/update"
                    else ({"active": values["active"]} if original == "users/set_active" else {}),
                    "delete": original == "users/delete",
                }
            ]
            stamp = manager.repository.bulk_stamp()
        elif original == "backups/apply":
            review = data["backups"].reviews.get(values.get("review_id"))
            if not review or review["actor"] != actor or review["errors"]:
                raise AccessError("backup_review_expired")
            changes, stamp = review["changes"], review["stamp"]
        else:
            raise AccessError("approval_command_unsupported")
        return await center.submit(actor, changes, stamp, msg["label"], effects)
    if command == "workflows/withdraw":
        return await center.withdraw(actor, msg["request_id"])
    if command in {"workflows/decide", "workflows/apply"}:
        if command == "workflows/decide":
            return await center.decide(actor, msg["request_id"], msg["approve"])
        # A removed or demoted approver cannot authorize a later application.
        item = center.data["approvals"].get(msg["request_id"])
        approver = (
            await hass.auth.async_get_user(item["approver"]) if item and item["approver"] else None
        )
        if not approver or not approver.is_active or not approver.is_admin:
            raise AccessError("approval_required")
        return await center.apply_approval(actor, msg["request_id"])
    if command == "workflows/transfer_start":
        if msg["confirmed"] is not True:
            raise AccessError("confirmation_required")
        return await center.transfer_start(
            actor, msg["kind"], msg["source"], msg["target"], msg["revision"], msg["value"]
        )
    if command in {"workflows/transfer_begin", "workflows/transfer_finish"}:
        item = center.data["transfers"].get(msg["transfer_id"])
        if item and item.get("approved_by") and not msg.get("cancel", False):
            approver = await hass.auth.async_get_user(item["approved_by"])
            if not approver or not approver.is_active or not approver.is_admin:
                raise AccessError("approval_required")
    if command == "workflows/transfer_review":
        return await center.transfer_review(actor, msg["transfer_id"], msg["approve"])
    if command == "workflows/transfer_recheck":
        return await center.transfer_recheck(actor, msg["transfer_id"])
    if command == "workflows/transfer_begin":
        return await center.transfer_begin(actor, msg["transfer_id"])
    if command == "workflows/transfer_finish":
        if msg["confirmed"] is not True:
            raise AccessError("confirmation_required")
        return await center.transfer_finish(actor, msg["transfer_id"], msg["cancel"])
    if command == "workflows/inventory_save":
        return await center.inventory_save(msg["card_id"], msg["revision"], msg["values"])
    if command == "workflows/inventory_return":
        if msg["confirmed"] is not True:
            raise AccessError("confirmation_required")
        return await center.inventory_return(msg["card_id"], msg["revision"], msg["delete"])
    if command == "workflows/inventory_issue":
        if msg["confirmed"] is not True:
            raise AccessError("confirmation_required")
        return await center.inventory_issue(msg["card_id"], msg["user_id"], msg["revision"])
    if command == "workflows/template_save":
        return await center.template_save(msg["template_id"], msg["revision"], msg["values"])
    if command == "workflows/template_delete":
        return await center.template_delete(msg["template_id"], msg["revision"])
    if command == "workflows/reminder_action":
        return await center.reminder_action(actor, msg["reminder_id"], msg["action"])
    if command == "workflows/renew_decide":
        return await center.renewal_decide(actor, msg["request_id"], msg["approve"])
    raise AccessError("unknown_command")


def _clean_patch(data: dict[str, Any]) -> dict[str, Any]:
    from .websocket import _patch

    return _patch(data)


def requires_approval(command: str, msg: dict[str, Any]) -> bool:
    if command == "workflows/inventory_save":
        return msg.get("values", {}).get("status") in {"lost", "blocked"}
    if command == "workflows/inventory_return":
        return not msg.get("delete", False)
    if command == "jobs/action":
        return msg.get("action") in {"resume", "retry_failed"}
    if command in {
        "users/create",
        "cards/add",
        "cards/remove",
        "cards/capture_confirm",
        "workflows/inventory_issue",
        "users/adopt",
        "users/delete_unmanaged",
        "users/temporary_cancel",
        "conflicts/resolve",
        "conflicts/resolve_deletion",
        "profiles/settings_update",
        "profiles/settings_apply",
        "users/bulk_apply",
        "jobs/bulk_create",
        "jobs/csv_create",
        "users/csv_apply",
        "users/delete",
        "users/set_active",
        "backups/apply",
    }:
        return True
    return command == "users/update" and bool(
        set(msg.get("data", {}))
        & {
            "active",
            "pin",
            "cards",
            "assignments",
            "permission_overrides",
            "door_permissions",
            "group_ids",
            "valid_from",
            "valid_until",
            "access_timing_policy",
        }
    )
