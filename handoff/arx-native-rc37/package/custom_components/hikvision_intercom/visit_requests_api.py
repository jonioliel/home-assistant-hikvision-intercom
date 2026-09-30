"""Authenticated host review; only the selected second operator can approve."""

from typing import Any

from homeassistant.core import HomeAssistant

from .access.models import AccessError
from .access_runtime import get_manager
from .const import DOMAIN
from .panel_permissions import area_allowed


async def dispatch_visits(
    hass: HomeAssistant, command: str, msg: dict[str, Any], actor: str
) -> Any:
    manager = get_manager(hass)
    permissions = hass.data[DOMAIN].get("panel_permissions")
    directory = [
        user
        for user in await hass.auth.async_get_users()
        if not getattr(user, "system_generated", False)
        and area_allowed(permissions, user, "users", "manage")
    ]
    if command == "visits/operators":
        return {"operators": [{"id": user.id, "name": user.name or ""} for user in directory]}
    if command == "visits/list":
        return manager.repository.visit_requests(
            offset=msg["offset"], limit=msg["limit"], filters=msg.get("filters"), actor=actor
        )
    if command in {"visits/create", "visits/request"}:
        if msg["approver_id"] not in {user.id for user in directory}:
            raise AccessError("visit_approver_unavailable")
        if msg["approver_id"] == actor:
            raise AccessError("visit_second_operator_required")
        if command == "visits/create":
            return await manager.async_create_visit(
                msg["data"], actor=actor, approver=msg["approver_id"]
            )
        result = await manager.repository.async_request_visit(
            msg["user_id"],
            expected_revision=msg["revision"],
            actor=actor,
            approver=msg["approver_id"],
        )
        manager._changed()
        return result
    return await manager.async_decide_visit(
        msg["request_id"], revision=msg["revision"], actor=actor, decision=msg["decision"]
    )
