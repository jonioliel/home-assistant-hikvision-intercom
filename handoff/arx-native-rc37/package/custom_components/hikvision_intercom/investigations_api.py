"""Detached, read-only administrative investigations over existing durable records."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from homeassistant.core import HomeAssistant

from .access.investigations import query
from .access_runtime import get_manager
from .const import DOMAIN


async def investigate(hass: HomeAssistant, msg: dict[str, Any]) -> dict[str, Any]:
    manager = get_manager(hass)
    now = datetime.now(UTC)
    events = hass.data[DOMAIN].get("events")
    records = []
    if events is not None:
        before = len(events.cache.rows)
        events.cache.prune(now)
        records = events.cache.dump()["records"]
        if len(events.cache.rows) != before:
            events.changed()
    state = manager.repository.snapshot()
    result = await asyncio.to_thread(
        query,
        state,
        records,
        filters=msg["filters"],
        offset=msg["offset"],
        limit=msg["limit"],
        snapshot=msg["snapshot"],
        now=now,
    )
    result["sources"] = {
        "access_available": events is not None,
        "access_storage_failed": bool(events and events.storage_failed),
    }
    names = {}
    for uid in {row["actor"] for row in result["records"] if row["actor"]}:
        operator = await hass.auth.async_get_user(uid)
        names[uid] = operator.name if operator else None
    result["actors"] = names
    return result
