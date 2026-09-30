"""Narrow authenticated personal portal; it grants no operator permissions."""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant

from .access.models import AccessError
from .access.renewal_portal import RenewalPortal, personal_account
from .const import DOMAIN

SELF_COMMANDS = frozenset({"renewal/self", "renewal/request", "renewal/cancel"})
SECURITY_COMMANDS = frozenset(
    {
        "security/session",
        "security/touch",
        "security/lock",
        "security/reauth_start",
        "security/reauth_step",
    }
)


def personal_allowed(hass: HomeAssistant, user: Any, command: str) -> bool:
    if not personal_account(user):
        return False
    if command in SELF_COMMANDS:
        return True
    # Personal sessions use the same idle lock and credential/MFA challenge even
    # before an administrator links a record. No operator data is granted.
    return command in SECURITY_COMMANDS


async def dispatch(
    hass: HomeAssistant, command: str, msg: dict[str, Any], actor: str, user: Any
) -> dict[str, Any]:
    current = await hass.auth.async_get_user(actor)
    if not personal_account(current) or not user or current.id != user.id:
        raise AccessError("unauthorized")
    portal = RenewalPortal(hass.data[DOMAIN]["workflows"])
    if command in SELF_COMMANDS:
        if command == "renewal/request":
            await portal.request(
                actor, msg["revision"], msg["until"], msg["reason"], msg["request_key"]
            )
        elif command == "renewal/cancel":
            await portal.cancel(actor, msg["request_id"])
        current = await hass.auth.async_get_user(actor)
        if not personal_account(current):
            raise AccessError("unauthorized")
        return {**portal.own(actor), "timezone": hass.config.time_zone, "api_contract": 1}
    if not current.is_admin:
        raise AccessError("unauthorized")
    if command == "renewal/binding_update":
        account = await hass.auth.async_get_user(msg["account_id"])
        if msg["user_id"] and not personal_account(account):
            raise AccessError("renewal_identity_inactive")
        await portal.bind(
            msg["account_id"], msg["user_id"] or None, msg["revision"], msg["confirmed"]
        )
    if command in {"renewal/bindings", "renewal/binding_update"}:
        directory = [
            {"id": account.id, "name": account.name, "active": account.is_active}
            for account in await hass.auth.async_get_users()
            if not getattr(account, "system_generated", False)
        ]
        if not current.is_active or not current.is_admin:
            raise AccessError("unauthorized")
        return {**portal.bindings(), "directory": directory}
    raise AccessError("unknown_command")
