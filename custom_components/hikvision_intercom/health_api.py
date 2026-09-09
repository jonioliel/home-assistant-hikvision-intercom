"""Administrative health snapshots, optional reads and recorded field acceptance."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from homeassistant.core import HomeAssistant

from .access.acceptance import Acceptance
from .access.models import AccessError
from .access_runtime import get_manager
from .client.media import MediaClient
from .const import DOMAIN, VERSION
from .diagnostics import async_get_config_entry_diagnostics
from .exceptions import HikvisionError


async def dispatch_health(hass: HomeAssistant, command: str, msg: dict[str, Any]) -> dict[str, Any]:
    manager = get_manager(hass)
    station = manager._station(msg["station_id"])
    entry = hass.config_entries.async_get_entry(station.id)
    if entry is None:
        raise AccessError("station_unloaded")
    runtime = getattr(entry, "runtime_data", None)
    data = hass.data[DOMAIN]
    if command.startswith("acceptance/"):
        acceptance = data.get("acceptance")
        if not isinstance(acceptance, Acceptance):
            raise AccessError("acceptance_unavailable")
        if command == "acceptance/update":
            return await acceptance.update(station.id, msg["step"], msg["state"], msg["revision"])
        return acceptance.public(station.id)
    if command == "media/call":
        if not runtime or runtime.session.is_closed:
            raise AccessError("station_unloaded")
        reads = data.setdefault("call_reads", set())
        if station.id in reads or len(reads) >= 3:
            raise AccessError("device_busy")
        reads.add(station.id)
        try:
            result = await MediaClient(runtime.client).call_context()
            if getattr(entry, "runtime_data", None) is not runtime or runtime.session.is_closed:
                raise AccessError("station_unloaded")
            cached = data.get("call_results", {}).get(station.id)
            result["last_result"] = cached[1] if cached and cached[0] is runtime else None
            result["busy"] = station.id in data.get("call_commands_busy", set())
            return result
        finally:
            reads.discard(station.id)
    if command == "media/signal":
        if not runtime or runtime.session.is_closed:
            raise AccessError("station_unloaded")
        busy = data.setdefault("call_commands_busy", set())
        if station.id in busy:
            raise AccessError("device_busy")
        busy.add(station.id)
        try:
            if msg["command"] in {"reject", "hangUp"}:
                bridge = data.get("audio_sessions", {}).get(station.id)
                if bridge and bridge.runtime is runtime:
                    bridge.cancel()
                    if bridge.task:
                        await asyncio.gather(bridge.task, return_exceptions=True)
            operations = data.setdefault("call_operations", {})
            task = asyncio.create_task(MediaClient(runtime.client).signal(msg["command"]))
            operations[station.id] = (runtime, task)
            result = await task
            if getattr(entry, "runtime_data", None) is not runtime or runtime.session.is_closed:
                raise AccessError("station_unloaded")
            data.setdefault("call_results", {})[station.id] = (runtime, result)
            return result
        finally:
            operations = data.get("call_operations", {})
            if station.id in operations and operations[station.id][0] is runtime:
                operations.pop(station.id, None)
            busy.discard(station.id)
    if command == "health/refresh":
        if not runtime or runtime.session.is_closed:
            raise AccessError("station_unloaded")
        busy = data.setdefault("health_reads", set())
        if station.id in busy or len(busy) >= 3:
            raise AccessError("device_busy")
        busy.add(station.id)
        try:
            async with asyncio.timeout(35):
                if runtime.clock:
                    await runtime.clock.async_refresh()
                try:
                    media = await MediaClient(runtime.client).inspect()
                except (HikvisionError, TimeoutError):
                    media = {
                        "checked_at": datetime.now(UTC).isoformat(),
                        "errors": {"probe": "media_read_failed"},
                    }
                # A reload must not attach old evidence to a replacement runtime.
                if (
                    getattr(entry, "runtime_data", None) is runtime
                    and not runtime.session.is_closed
                ):
                    data.setdefault("media_evidence", {})[station.id] = (runtime, media)
        finally:
            busy.discard(station.id)
    report = await async_get_config_entry_diagnostics(hass, entry)
    clock = runtime.clock.public() if runtime and runtime.clock else {}
    report["clock"] = {
        key: clock.get(key)
        for key in ("source", "zone", "status", "checked_at", "skew_seconds", "error")
    }
    cached = data.get("media_evidence", {}).get(station.id)
    report["media"] = cached[1] if cached and cached[0] is runtime else None
    bridge = data.get("audio_sessions", {}).get(station.id)
    last_audio = data.get("audio_results", {}).get(station.id)
    report["audio"] = {
        "active": bool(bridge and bridge.runtime is runtime and not bridge.stopped),
        "last_result": last_audio[1] if last_audio and last_audio[0] is runtime else None,
    }
    report["generated_at"] = datetime.now(UTC).isoformat()
    report["format"] = "hikvision_intercom.compatibility"
    report["integration_version"] = VERSION
    report["evidence_scope"] = "software_observation_not_physical_acceptance"
    return report
