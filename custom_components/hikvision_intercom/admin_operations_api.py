"""Administrator bulk operations, change history and read-only permission audits."""

from __future__ import annotations

import asyncio
from typing import Any

from homeassistant.core import HomeAssistant

from .access.admin_audit import export, query
from .access.models import AccessError, text_field
from .access.permission_audit import inspect_permissions
from .access_runtime import get_manager
from .const import DOMAIN


async def dispatch_admin(hass: HomeAssistant, command: str, msg: dict[str, Any], actor: str) -> Any:
    if not actor:
        raise AccessError("unauthorized")
    manager = get_manager(hass)
    if command == "permissions/directory":
        from .access.permission_directory import directory

        sid = text_field(msg["filters"].get("station_id", ""), 128, empty=True)
        if sid and sid not in manager.stations:
            raise AccessError("station_not_found")
        stamp = manager.repository.bulk_stamp()
        result = await asyncio.to_thread(directory, manager.repository.snapshot(), msg["filters"])
        if manager._closed or stamp != manager.repository.bulk_stamp():
            raise AccessError("bulk_review_stale")
        return result
    if command == "profiles/settings_preview":
        return await manager.policy.preview(actor, msg["revision"], msg["values"])
    if command == "profiles/settings_apply":
        return await manager.policy.apply(actor, msg["operation_id"])
    if command == "users/bulk_preview":
        return await manager.bulk.preview(actor, msg["request"])
    if command == "users/bulk_apply":
        return await manager.bulk.apply(actor, msg["operation_id"])
    if command == "users/bulk_receipt":
        return manager.bulk.receipt(actor, msg["operation_id"])
    if command == "users/bulk_receipts":
        return manager.bulk.receipts(actor)
    if command in {"audit/list", "audit/export"}:
        database = manager.repository._state["admin_audit"]
        report = await asyncio.to_thread(
            export if command == "audit/export" else query, database, msg["filters"]
        )
        # The authenticated server user ID is authoritative. No actor supplied in the request.
        actors = {row["actor"] for row in report["records"] if row["actor"]}
        names = {}
        for uid in sorted(actors)[:100]:
            user = await hass.auth.async_get_user(uid)
            names[uid] = user.name if user else None
        report["actors"] = names
        return report
    if command == "stations/permission_audit":
        busy = hass.data[DOMAIN].setdefault("permission_audits", set())
        sid = msg["station_id"]
        if sid in busy or len(busy) >= 3:
            raise AccessError("device_busy")
        busy.add(sid)
        try:
            return await inspect_permissions(manager, sid)
        except TimeoutError:
            raise AccessError("permission_timeout") from None
        finally:
            busy.discard(sid)
    raise AccessError("unknown_command")
