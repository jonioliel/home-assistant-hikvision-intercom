"""Administrator proposal API: local reservations and bounded station reads only."""

from __future__ import annotations

import asyncio
from typing import Any

from homeassistant.core import HomeAssistant

from .access.models import AccessError
from .access.schedule_compiler import bindings_for, compile_schedule
from .access.schedule_plans import SchedulePlans
from .access.schedules import ScheduleLibrary
from .access_runtime import get_manager
from .client.schedule_plan_inspection import inspect_plan
from .const import DOMAIN


def source(hass: HomeAssistant, identifier: str, revision: int | None = None) -> dict[str, Any]:
    library = hass.data[DOMAIN].get("schedules")
    if not isinstance(library, ScheduleLibrary):
        raise AccessError("invalid_storage")
    item = next((s for s in library.list() if s["id"] == identifier), None)
    if not item:
        raise AccessError("schedule_not_found")
    if revision is not None and (type(revision) is not int or revision != item["revision"]):
        raise AccessError("revision_conflict")
    return item


def annotate(hass: HomeAssistant, result: dict[str, Any]) -> dict[str, Any]:
    try:
        current = source(hass, result["draft_id"])
        status = "current" if current["revision"] == result["draft_revision"] else "changed"
    except AccessError as err:
        status = "missing" if err.code == "schedule_not_found" else "unavailable"
    return {**result, "source_state": status}


async def dispatch_plans(hass: HomeAssistant, command: str, msg: dict[str, Any], actor: str) -> Any:
    store = hass.data[DOMAIN].get("schedule_plans")
    if not isinstance(store, SchedulePlans):
        raise AccessError("schedule_plan_storage_unavailable")
    if command == "schedules/plan_list":
        return [annotate(hass, item) for item in store.all()]
    if command == "schedules/plan_delete":
        await store.async_delete(msg["plan_id"], msg["revision"])
        return {"deleted": True}
    if command == "schedules/plan_export":
        return annotate(
            hass, store.public(store.get(msg["plan_id"], msg["revision"]), details=True)
        )
    manager = get_manager(hass)
    if command == "schedules/plan_save":
        pending = store.pending(msg["token"], actor)
        station_id = pending["station_id"]
    elif command == "schedules/plan_recheck":
        pending = store.get(msg["plan_id"], msg["revision"])
        station_id = pending["station_id"]
    else:
        pending = {}
        station_id = msg["station_id"]
    station = manager._station(station_id)
    driver = manager._driver(station)
    entry = hass.config_entries.async_get_entry(station_id)
    runtime = getattr(entry, "runtime_data", None)
    identity = store.fingerprint(
        [driver.client._expected_identity, runtime.profile.firmware if runtime else None]
    )
    if command == "schedules/plan_save":
        current = source(hass, pending["draft_id"])
        return annotate(
            hass, await store.async_save(msg["token"], actor, identity, current["revision"])
        )
    if pending:
        if pending["identity"] != identity:
            raise AccessError("schedule_plan_device_changed")
        draft, slots = pending["draft"], pending["bindings"]
        expected = compile_schedule(draft, slots, pending["capabilities"])
    else:
        current = source(hass, msg["schedule_id"], msg["revision"])
        draft = {k: current[k] for k in ("name", "weekly", "holidays")}
        slots = bindings_for(msg["bindings"], len(draft["holidays"]))
        expected = None
    busy = hass.data[DOMAIN].setdefault("schedule_reads", set())
    if station_id in busy or len(busy) >= 3:
        raise AccessError("schedule_read_busy")
    busy.add(station_id)
    try:
        async with asyncio.timeout(130):
            async with manager._read_slots:
                inspection = await inspect_plan(
                    driver.client, draft, slots, store.fingerprint, expected=expected
                )
        if station.driver is not driver or manager._closed:
            raise AccessError("station_unloaded")
        if pending:
            return annotate(
                hass,
                await store.async_recheck(pending["id"], pending["revision"], identity, inspection),
            )
        source(hass, current["id"], current["revision"])
        return annotate(
            hass,
            store.preview(
                station_id,
                identity,
                current["id"],
                current["revision"],
                draft,
                slots,
                inspection,
                actor,
            ),
        )
    except TimeoutError:
        raise AccessError("connection_failed") from None
    finally:
        busy.discard(station_id)
