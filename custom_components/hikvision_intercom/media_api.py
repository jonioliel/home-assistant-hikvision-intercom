"""Global administrator settings and read-only go2rtc reachability."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from aiohttp import ClientSession
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .access.models import AccessError
from .const import DOMAIN
from .media_settings import MediaSettings


def settings(hass: HomeAssistant) -> MediaSettings:
    result = hass.data[DOMAIN].get("media_settings")
    if not isinstance(result, MediaSettings):
        raise AccessError("media_settings_unavailable")
    return result


def provider(hass: HomeAssistant) -> tuple[ClientSession, str]:
    # HA 2026.9 go2rtc Go2RtcConfig includes its authenticated session (also Unix socket).
    # Never send these credentials, or the station RTSP URL, to the browser.
    if url := settings(hass).public()["go2rtc_url"]:
        return async_get_clientsession(hass), url
    config = hass.data.get("go2rtc")
    session, url = getattr(config, "session", None), getattr(config, "url", None)
    if not isinstance(session, ClientSession) or not isinstance(url, str) or session.closed:
        raise AccessError("mse_provider_unavailable")
    return session, url.rstrip("/")


async def dispatch_media(hass: HomeAssistant, command: str, msg: dict[str, Any]) -> dict[str, Any]:
    current = settings(hass)
    if command == "media/settings_get":
        return current.public()
    if command == "media/settings_update":
        return await current.update(msg["revision"], msg["values"])
    try:
        session, url = provider(hass)
        async with asyncio.timeout(6):
            async with session.get(url + "/api", allow_redirects=False) as response:
                if response.status != 200:
                    raise AccessError("mse_provider_failed")
                raw = bytearray()
                async for chunk in response.content.iter_chunked(4096):
                    raw.extend(chunk)
                    if len(raw) > 8192:
                        raise AccessError("mse_provider_failed")
                payload = json.loads(raw)
                if not isinstance(payload, dict) or not isinstance(payload.get("version"), str):
                    raise AccessError("mse_provider_failed")
        return {
            "available": True,
            "source": "explicit" if current.public()["go2rtc_url"] else "home_assistant",
        }
    except AccessError:
        raise
    except Exception:
        raise AccessError("mse_provider_failed") from None
