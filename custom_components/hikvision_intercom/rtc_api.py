"""Authenticated go2rtc RTC signaling bridge. Camera source and credentials remain in HA."""

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

MAX_MESSAGE = 262144


def valid_offer(offer: Any) -> bool:
    """Only viewing is authorized here; microphone transmission has a separate API."""
    if not isinstance(offer, str) or len(offer) > MAX_MESSAGE or not offer.startswith("v=0"):
        return False
    sections = re.split(r"(?m)^m=", offer.replace("\r\n", "\n"))[1:]
    return bool(sections) and all(
        part.startswith(("audio ", "video "))
        and "\na=recvonly\n" in part
        and not re.search(r"(?m)^a=(sendrecv|sendonly)$", part)
        for part in sections
    )


class RTCView(HomeAssistantView):
    url = "/api/hikvision_intercom/rtc/{station_id}"
    name = "api:hikvision_intercom:rtc"
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
        if policy["transport"] != "webrtc" or policy["webrtc_mode"] != "rtc":
            raise web.HTTPConflict()
        revision = policy["revision"]
        # Continuous video, bounded upstream reads and downstream writes detect stalls.
        # Avoid aiohttp heartbeat timers racing with concurrent receive/close.
        ws = web.WebSocketResponse(max_msg_size=262144)
        self.active.add(ws)
        self.finished.clear()
        tasks: list[asyncio.Task[Any]] = []
        try:
            await ws.prepare(request)
            async with asyncio.timeout(10):
                greeting = await ws.receive_json()
            if (
                not isinstance(greeting, dict)
                or set(greeting) != {"offer"}
                or not valid_offer(greeting["offer"])
            ):
                raise AccessError("rtc_protocol_error")
            session, url = provider(self.hass)
            # go2rtc GetOrPatch accepts an RTSP source without persisting configuration.
            source = runtime.client.settings.rtsp_source()
            async with asyncio.timeout(10):
                upstream = await session.ws_connect(
                    url + "/api/ws", params={"src": source}, max_msg_size=MAX_MESSAGE
                )
            async with upstream:
                await upstream.send_json({"type": "webrtc/offer", "value": greeting["offer"]})

                async def forward() -> None:
                    answered = False
                    count = 0
                    while True:
                        # Signaling can remain silent for the lifetime of an active RTC stream.
                        async with asyncio.timeout(None if answered else 15):
                            message = await upstream.receive()
                        count += 1
                        if message.type != WSMsgType.TEXT or count > 256:
                            raise AccessError("rtc_connection_lost")
                        value = json.loads(message.data)
                        if not isinstance(value, dict) or not isinstance(value.get("value"), str):
                            raise AccessError("rtc_protocol_error")
                        payload = value["value"]
                        if value.get("type") == "webrtc/answer" and not answered:
                            if len(payload) > 262144 or not payload.startswith("v=0"):
                                raise AccessError("rtc_protocol_error")
                            answered = True
                            await ws.send_json({"type": "answer", "answer": payload})
                        elif value.get("type") == "webrtc/candidate" and len(payload) <= 4096:
                            await ws.send_json(
                                {
                                    "type": "candidate",
                                    "candidate": {"candidate": payload, "sdpMid": "0"},
                                }
                            )
                        else:
                            raise AccessError("rtc_signaling_failed")

                async def watch_client() -> None:
                    count = 0
                    while True:
                        async with asyncio.timeout(35):
                            message = await ws.receive()
                        if message.type != WSMsgType.TEXT:
                            return
                        value = json.loads(message.data)
                        if value == {"type": "ping"}:
                            await ws.send_json({"type": "pong"})
                            continue
                        count += 1
                        if (
                            count > 100
                            or not isinstance(value, dict)
                            or set(value) != {"candidate"}
                            or not isinstance(value["candidate"], str)
                            or len(value["candidate"]) > 4096
                            or not value["candidate"].startswith("candidate:")
                        ):
                            raise AccessError("rtc_protocol_error")
                        await upstream.send_json(
                            {"type": "webrtc/candidate", "value": value["candidate"]}
                        )

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
                    raise AccessError("rtc_session_changed")

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
            code = error.code if isinstance(error, AccessError) else "rtc_connection_lost"
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
def register_rtc(hass: HomeAssistant) -> None:
    view = RTCView(hass)
    hass.data[DOMAIN]["rtc_view"] = view
    hass.http.register_view(view)
    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, view.stop)
