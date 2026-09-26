"""Administrator clock settings and capability-gated Supervisor NTP integration."""

from __future__ import annotations

import asyncio
import os
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .access.models import AccessError
from .client.ntp import synchronize
from .const import DOMAIN
from .ntp_settings import NtpSettings


async def supervisor(
    hass: HomeAssistant, path: str, data: dict[str, Any] | None = None
) -> dict[str, Any]:
    token = os.environ.get("SUPERVISOR_TOKEN")
    if not token or "hassio" not in hass.config.components:
        raise AccessError("operation_unsupported")
    session = async_get_clientsession(hass)
    async with (
        asyncio.timeout(15),
        session.request(
            "POST" if data is not None else "GET",
            "http://supervisor" + path,
            headers={"Authorization": f"Bearer {token}"},
            json=data,
            allow_redirects=False,
        ) as response,
    ):
        if response.status != 200:
            raise AccessError("operation_unsupported")
        body = await response.json()
        if body.get("result") != "ok" or not isinstance(body.get("data"), dict):
            raise AccessError("invalid_response")
        return dict(body["data"])


async def dispatch_clock(hass: HomeAssistant, command: str, msg: dict[str, Any]) -> dict[str, Any]:
    settings = hass.data[DOMAIN].get("ntp_settings")
    if not isinstance(settings, NtpSettings):
        raise AccessError("invalid_storage")
    if command == "clock/settings_get":
        return settings.public()
    if command == "clock/settings_update":
        return await settings.update(msg["revision"], msg["values"])
    if command == "clock/host_status":
        try:
            info = await supervisor(hass, "/host/info")
            supported = "ntp" in info.get("features", [])
            config = (await supervisor(hass, "/time/info")).get("config") if supported else None
            return {
                "supported": supported,
                "synchronized": info.get("dt_synchronized"),
                "use_ntp": info.get("use_ntp"),
                "config": config,
            }
        except (AccessError, TimeoutError):
            return {"supported": False, "synchronized": None, "config": None}
    # Freeze central settings for the whole operation; stale callers must reload.
    values = settings.public()
    if type(msg["revision"]) is not int or msg["revision"] != values.pop("revision"):
        raise AccessError("revision_conflict")
    if command == "clock/host_apply":
        async with settings.lock:
            if settings.public()["revision"] != msg["revision"]:
                raise AccessError("revision_conflict")
            info = await supervisor(hass, "/host/info")
            if "ntp" not in info.get("features", []) or values["port"] != 123:
                raise AccessError("operation_unsupported")
            await supervisor(
                hass, "/time/options", {"servers": [values["server"]], "fallback_servers": []}
            )
            actual = await supervisor(hass, "/time/info")
            if actual.get("config") != {"servers": [values["server"]], "fallback_servers": []}:
                raise AccessError("readback_mismatch")
            return {"configuration_verified": True, "config": actual["config"]}
    entry = hass.config_entries.async_get_entry(msg["station_id"])
    runtime = getattr(entry, "runtime_data", None) if entry and entry.domain == DOMAIN else None
    if runtime is None or runtime.is_closed:
        raise AccessError("station_unloaded")
    busy = hass.data[DOMAIN].setdefault("clock_writes", set())
    if entry.entry_id in busy or len(busy) >= 3:
        raise AccessError("device_busy")
    busy.add(entry.entry_id)
    try:
        result = await synchronize(runtime.client, values, copy_system=msg["copy_system"])
        if runtime.clock is not None:
            await runtime.clock.async_refresh()
        return result
    finally:
        busy.discard(entry.entry_id)
