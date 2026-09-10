"""Admin-only same-origin binary MSE bridge; source URLs stay inside HA."""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from aiohttp import WSMsgType, web
from homeassistant.components.http import HomeAssistantView
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import HomeAssistant, callback

from .access.models import AccessError
from .const import DOMAIN
from .media_api import provider, settings

CODECS = frozenset({"avc1.640029", "avc1.64002A", "avc1.640033", "hvc1.1.6.L153.B0"})
MAX_MESSAGE = 4 * 1024 * 1024
MIME = re.compile(r'^video/mp4; codecs="(?:avc1|hvc1|hev1)[A-Za-z0-9.]+"$')


class MSEView(HomeAssistantView):
    url = "/api/hikvision_intercom/mse/{station_id}"
    name = "api:hikvision_intercom:mse"
    requires_auth = True

    def __init__(self, hass: HomeAssistant):
        self.hass = hass
        self.active: set[web.WebSocketResponse] = set()
        self.finished = asyncio.Event()
        self.finished.set()

    async def get(self, request: web.Request, station_id: str) -> web.StreamResponse:
        user = request.get("hass_user")
        if not user or not user.is_admin or not user.is_active:
            raise web.HTTPForbidden()
        entry = self.hass.config_entries.async_get_entry(station_id)
        runtime = getattr(entry, "runtime_data", None) if entry and entry.domain == DOMAIN else None
        if runtime is None or runtime.is_closed or not runtime.profile.stream:
            raise web.HTTPNotFound()
        if len(self.active) >= 9:
            raise web.HTTPTooManyRequests()
        policy = settings(self.hass).public()
        if policy["transport"] != "webrtc" or policy["webrtc_mode"] != "mse":
            raise web.HTTPConflict()
        revision = policy["revision"]
        # Continuous video, bounded upstream reads and downstream writes detect stalls.
        # Avoid aiohttp heartbeat timers racing with concurrent receive/close.
        ws = web.WebSocketResponse(max_msg_size=1024)
        self.active.add(ws)
        self.finished.clear()
        tasks: list[asyncio.Task[Any]] = []
        try:
            await ws.prepare(request)
            async with asyncio.timeout(10):
                greeting = await ws.receive_json()
            if (
                not isinstance(greeting, dict)
                or set(greeting) != {"codecs"}
                or not isinstance(greeting["codecs"], list)
                or not greeting["codecs"]
                or len(greeting["codecs"]) > len(CODECS)
                or any(not isinstance(c, str) or c not in CODECS for c in greeting["codecs"])
            ):
                raise AccessError("mse_protocol_error")
            session, url = provider(self.hass)
            # go2rtc GetOrPatch accepts an RTSP source without persisting configuration.
            source = runtime.client.settings.rtsp_source()
            async with asyncio.timeout(10):
                upstream = await session.ws_connect(
                    url + "/api/ws", params={"src": source}, max_msg_size=MAX_MESSAGE
                )
            async with upstream:
                await upstream.send_json({"type": "mse", "value": ",".join(greeting["codecs"])})

                async def forward() -> None:
                    negotiated = False
                    while True:
                        async with asyncio.timeout(12):
                            message = await upstream.receive()
                        if message.type == WSMsgType.TEXT:
                            if negotiated or len(message.data) > 1024:
                                raise AccessError("mse_protocol_error")
                            value = json.loads(message.data)
                            mime = value.get("value") if isinstance(value, dict) else None
                            if not (
                                isinstance(value, dict)
                                and value.get("type") == "mse"
                                and isinstance(mime, str)
                                and MIME.fullmatch(mime)
                            ):
                                raise AccessError("mse_codec_unavailable")
                            negotiated = True
                            await ws.send_json({"type": "mse", "value": mime})
                        elif message.type == WSMsgType.BINARY and negotiated:
                            if not message.data or len(message.data) > MAX_MESSAGE:
                                raise AccessError("mse_protocol_error")
                            # Bound buffering for slow clients.
                            async with asyncio.timeout(3):
                                await ws.send_bytes(message.data)
                        else:
                            raise AccessError("mse_connection_lost")

                async def watch_client() -> None:
                    async for _message in ws:
                        # No client commands after the codec handshake (including no microphone).
                        raise AccessError("mse_protocol_error")

                async def watch_owner() -> None:
                    while True:
                        valid = (
                            user.is_admin
                            and user.is_active
                            and not runtime.is_closed
                            and getattr(
                                self.hass.config_entries.async_get_entry(station_id),
                                "runtime_data",
                                None,
                            )
                            is runtime
                            and settings(self.hass).public()["revision"] == revision
                        )
                        if not valid:
                            break
                        await asyncio.sleep(0.5)
                    raise AccessError("mse_session_changed")

                tasks = [
                    asyncio.create_task(forward()),
                    asyncio.create_task(watch_client()),
                    asyncio.create_task(watch_owner()),
                ]
                done, _pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    task.result()
        except asyncio.CancelledError:
            raise
        except Exception as error:
            # Remote error text can contain RTSP credentials. Only our own codes leave HA.
            code = error.code if isinstance(error, AccessError) else "mse_connection_lost"
            if ws.prepared and not ws.closed:
                try:
                    await ws.send_json({"type": "error", "code": code})
                except (ConnectionError, RuntimeError):
                    pass
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            try:
                if ws.prepared:
                    await ws.close()
            finally:
                self.active.discard(ws)
                if not self.active:
                    self.finished.set()
        return ws

    async def stop(self, _event: Any) -> None:
        await asyncio.gather(*(ws.close() for ws in tuple(self.active)))


@callback
def register_mse(hass: HomeAssistant) -> None:
    view = MSEView(hass)
    hass.data[DOMAIN]["mse_view"] = view
    hass.http.register_view(view)
    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, view.stop)
