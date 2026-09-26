"""Administrator station settings without arbitrary URL/body passthrough."""

from __future__ import annotations

import asyncio
from typing import Any

from homeassistant.core import HomeAssistant

from .access.diagnostics import error_code
from .access.models import AccessError, utc_now
from .access_runtime import get_manager
from .client.parser import find_values
from .client.technical import boolean, password_status, read_door, update_door
from .configuration import managed_locks
from .const import DOMAIN
from .exceptions import HikvisionAuthError, HikvisionError


async def dispatch_technical(hass: HomeAssistant, command: str, msg: dict[str, Any]) -> Any:
    entry = hass.config_entries.async_get_entry(msg["station_id"])
    runtime = getattr(entry, "runtime_data", None) if entry and entry.domain == DOMAIN else None
    if runtime is None or runtime.is_closed:
        raise AccessError("station_unloaded")
    client = runtime.client
    busy = hass.data[DOMAIN].setdefault("technical_busy", set())
    if entry.entry_id in busy or len(busy) >= 3:
        raise AccessError("device_busy")
    busy.add(entry.entry_id)
    try:
        async with asyncio.timeout(75):
            if command.startswith("stations/technical_codes_"):
                from .client.public_codes import inspect, mutate

                return (
                    await inspect(client) if command.endswith("get") else await mutate(client, msg)
                )
            if command.startswith("stations/technical_program_"):
                from .client.technical import verify_hold_support

                programs = hass.data[DOMAIN]["hold_programs"]
                if command.endswith("list"):
                    drafts = hass.data[DOMAIN]["hold_open_drafts"]
                    return {
                        "programs": programs.listing(entry.entry_id),
                        "saved": [
                            drafts.get(entry.entry_id, lock.physical_index)
                            for lock in runtime.locks
                            if drafts.get(entry.entry_id, lock.physical_index)
                        ],
                        "timezone": hass.config.time_zone,
                        "native_supported": False,
                    }
                if command.endswith("save"):
                    lock = next(
                        (lock for lock in runtime.locks if lock.physical_index == msg["door"]), None
                    )
                    if lock is None:
                        raise AccessError("operation_unsupported")
                    if msg["enabled"]:
                        await client.async_confirm_identity()
                        await verify_hold_support(client, lock.api_id)
                    await programs.update(
                        entry.entry_id,
                        msg["door"],
                        msg["revision"],
                        msg["policy"],
                        runtime.profile.unique_id,
                        lock.api_id,
                        msg["enabled"],
                    )
                    drafts = hass.data[DOMAIN]["hold_open_drafts"]
                    previous = drafts.get(entry.entry_id, msg["door"])
                    if previous:
                        await drafts.remove(entry.entry_id, msg["door"], previous["revision"])
                else:
                    await programs.action(
                        entry.entry_id, msg["door"], msg["revision"], msg["action"]
                    )
                return {"programs": programs.listing(entry.entry_id)}
            if command in {
                "stations/technical_hold_get",
                "stations/technical_hold_save",
                "stations/technical_hold_delete",
            }:
                from .access.hold_open import HoldOpenDrafts

                drafts = hass.data[DOMAIN].get("hold_open_drafts")
                if not isinstance(drafts, HoldOpenDrafts):
                    raise AccessError("invalid_storage")
                if type(msg["door"]) is not int or msg["door"] not in {
                    lock.physical_index for lock in runtime.locks
                }:
                    raise AccessError("operation_unsupported")
                if command.endswith("delete"):
                    await drafts.remove(entry.entry_id, msg["door"], msg["revision"])
                    return {"deleted": True}
                if command.endswith("save"):
                    item = await drafts.update(
                        entry.entry_id, msg["door"], msg["revision"], msg["policy"]
                    )
                else:
                    item = drafts.get(entry.entry_id, msg["door"])
                return {
                    "draft": item,
                    "active": False,
                    "blocker": "schedule_writes_unverified",
                    "timezone": hass.config.time_zone,
                }
            if command == "stations/technical_relays":
                if msg["expected"] != entry.data.get("locks", []):
                    raise AccessError("revision_conflict")
                selected = managed_locks({"locks": msg["locks"]})
                previous = managed_locks(entry.data)
                if any(lock.api_id not in runtime.profile.api_door_ids for lock in selected):
                    raise AccessError("operation_unsupported")
                removed = {(lock.physical_index, lock.api_id) for lock in previous} - {
                    (lock.physical_index, lock.api_id) for lock in selected
                }
                if removed and any(
                    p["door"] == physical
                    for p in hass.data[DOMAIN]["hold_programs"].listing(entry.entry_id)
                    for physical, _api in removed
                ):
                    raise AccessError("hold_pause_before_edit")
                if removed and get_manager(hass).has_access(entry.entry_id):
                    raise AccessError("access_removal_pending")
                hass.config_entries.async_update_entry(
                    entry,
                    data={
                        **entry.data,
                        "locks": [
                            {
                                "physical_index": lock.physical_index,
                                "api_id": lock.api_id,
                                "confirmed": True,
                                **({"name": lock.name} if lock.name else {}),
                            }
                            for lock in selected
                        ],
                    },
                )
                hass.async_create_task(hass.config_entries.async_reload(entry.entry_id))
                return {"reload_required": True}
            if command == "stations/technical_update":
                if msg["door"] not in {lock.api_id for lock in managed_locks(entry.data)}:
                    raise AccessError("operation_unsupported")
                if msg["confirmed"] is not True:
                    raise AccessError("invalid_fields")
                result = await update_door(client, msg["door"], msg["expected"], msg["changes"])
            else:
                await client.async_confirm_identity()
                report: dict[str, Any] = {
                    "checked_at": utc_now(),
                    "doors": [],
                    "passwords": None,
                    "password_error": None,
                    "features": [],
                    "relay_selection": entry.data.get("locks", []),
                }
                for family in ("AccessControl", "VideoIntercom"):
                    caps = await client._get(f"/ISAPI/{family}/capabilities")
                    root = caps.get(family, caps.get(family + "Cap", caps))

                    # Only boolean capability flags; never arbitrary configuration values.
                    def flags(value: Any, family: str = family) -> None:
                        if isinstance(value, dict):
                            for key, item in value.items():
                                if key.startswith("isSupport") and boolean(item) is not None:
                                    report["features"].append(
                                        {"family": family, "name": key, "supported": boolean(item)}
                                    )
                                elif isinstance(item, dict):
                                    flags(item)

                    flags(root)
                    if family == "VideoIntercom":
                        values = find_values(caps, "isSupportPrivilegePasswordStatus")
                        if len(values) == 1 and boolean(values[0]) is True:
                            try:
                                report["passwords"] = password_status(
                                    (
                                        await client._get(
                                            "/ISAPI/VideoIntercom/PrivilegePasswordStatus"
                                        )
                                    ).get("PrivilegePasswordStatus")
                                )
                            except HikvisionAuthError:
                                raise
                            except HikvisionError as err:
                                report["password_error"] = error_code(err)
                for door in (1, 2):
                    try:
                        report["doors"].append(await read_door(client, door))
                    except HikvisionAuthError:
                        raise
                    except HikvisionError as err:
                        report["doors"].append({"door": door, "error": error_code(err)})
                result = report
            if getattr(entry, "runtime_data", None) is not runtime or runtime.is_closed:
                raise AccessError("station_unloaded")
            return result
    finally:
        busy.discard(entry.entry_id)
