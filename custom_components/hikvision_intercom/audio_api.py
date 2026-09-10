"""Connection-owned administrator audio bridge; no recording or device secrets."""

from __future__ import annotations

import asyncio
import base64
import binascii
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .client.audio import PACKET_BYTES, AudioError, AudioSession
from .const import DOMAIN
from .exceptions import HikvisionError

MAX_SECONDS = 180
IDLE_SECONDS = 12


@dataclass(eq=False)
class AudioBridge:
    hass: HomeAssistant
    connection: websocket_api.ActiveConnection
    runtime: Any
    subscription: int
    token: str = field(default_factory=lambda: uuid4().hex)
    session: AudioSession | None = None
    task: asyncio.Task[None] | None = None
    touched: float = 0
    receiving: bool = False
    sequence: int = 0
    stopped: bool = False
    entered: bool = False

    def valid(self) -> bool:
        entry = self.hass.config_entries.async_get_entry(self.runtime.station_id)
        return bool(
            not self.stopped
            and self.connection.user
            and self.connection.user.is_admin
            and self.connection.user.is_active
            and entry
            and getattr(entry, "runtime_data", None) is self.runtime
            and not self.runtime.is_closed
            and self.subscription in self.connection.subscriptions
        )

    @callback
    def cancel(self) -> None:
        if self.stopped:
            return
        self.stopped = True
        if not self.entered:
            sessions = self.hass.data.get(DOMAIN, {}).get("audio_sessions", {})
            if sessions.get(self.runtime.station_id) is self:
                sessions.pop(self.runtime.station_id, None)
            if self.connection.subscriptions.pop(self.subscription, None):
                if self.connection.user and self.connection.user.is_admin:
                    self.connection.send_event(
                        self.subscription,
                        {
                            "format": "hikvision_intercom.audio",
                            "state": "closed",
                            "reason": "audio_stopped",
                            "close_confirmed": None,
                        },
                    )
        if self.task:
            self.task.cancel()

    async def run(self) -> None:
        self.entered = True
        reason = "audio_stopped"
        try:
            construction = self.hass.async_add_executor_job(AudioSession, self.runtime.client)
            try:
                self.session = await asyncio.shield(construction)
            except asyncio.CancelledError:
                self.session = await construction
                raise
            if not self.valid():
                return
            await self.session.start()
            if not self.valid():
                return
            started = self.hass.loop.time()
            self.touched = started
            self.connection.send_event(
                self.subscription,
                {
                    "format": "hikvision_intercom.audio",
                    "state": "ready",
                    "token": self.token,
                    "sample_rate": 8000,
                    "packet_bytes": PACKET_BYTES,
                    "max_seconds": MAX_SECONDS,
                },
            )
            while self.valid():
                now = self.hass.loop.time()
                if now - started >= MAX_SECONDS:
                    reason = "audio_expired"
                    break
                if now - self.touched >= IDLE_SECONDS:
                    reason = "audio_idle_timeout"
                    break
                if self.session.failure:
                    reason = self.session.failure
                    break
                await asyncio.sleep(0.2)
        except asyncio.CancelledError:
            pass
        except AudioError as err:
            reason = err.code
        except (HikvisionError, TimeoutError, OSError):
            reason = "audio_connection_lost"
        except Exception:
            # Do not log protocol headers, microphone packets or session identifiers.
            reason = "audio_connection_lost"
        finally:
            self.stopped = True
            if self.session:
                try:
                    await self.session.close()
                except Exception:
                    self.session.close_confirmed = False
            sessions = self.hass.data.get(DOMAIN, {}).get("audio_sessions", {})
            if sessions.get(self.runtime.station_id) is self:
                sessions.pop(self.runtime.station_id, None)
            self.hass.data.get(DOMAIN, {}).setdefault("audio_results", {})[
                self.runtime.station_id
            ] = (
                self.runtime,
                {
                    "reason": reason,
                    "close_confirmed": self.session.close_confirmed if self.session else None,
                    "received_bytes": self.session.received_bytes if self.session else 0,
                    "sent_bytes": self.session.sent_bytes if self.session else 0,
                    "microphone_packets_accepted": self.sequence,
                    "microphone_bytes_written": self.session.microphone_bytes
                    if self.session
                    else 0,
                    "physical_result": "unverified",
                },
            )
            if self.subscription in self.connection.subscriptions:
                self.connection.subscriptions.pop(self.subscription, None)
                if self.connection.user and self.connection.user.is_admin:
                    self.connection.send_event(
                        self.subscription,
                        {
                            "format": "hikvision_intercom.audio",
                            "state": "closed",
                            "reason": reason,
                            "close_confirmed": self.session.close_confirmed
                            if self.session
                            else None,
                        },
                    )


@websocket_api.websocket_command(
    vol.All(vol.Schema({"type": f"{DOMAIN}/audio/start"}, extra=vol.ALLOW_EXTRA))
)
@websocket_api.require_admin
@callback
def start(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    station = msg.get("station_id")
    if (
        set(msg) != {"id", "type", "station_id"}
        or not isinstance(station, str)
        or len(station) > 128
    ):
        connection.send_error(msg["id"], "invalid_fields", "Invalid audio request")
        return
    entry = hass.config_entries.async_get_entry(station)
    runtime = getattr(entry, "runtime_data", None) if entry and entry.domain == DOMAIN else None
    if runtime is None or runtime.is_closed:
        connection.send_error(msg["id"], "station_unloaded", "Station unavailable")
        return
    sessions = hass.data[DOMAIN].setdefault("audio_sessions", {})
    if (
        station in sessions
        or len(sessions) >= 3
        or any(item.connection is connection for item in sessions.values())
    ):
        connection.send_error(msg["id"], "audio_busy", "Audio is already in use")
        return
    bridge = AudioBridge(hass, connection, runtime, msg["id"])
    sessions[station] = bridge
    connection.subscriptions[msg["id"]] = bridge.cancel
    connection.send_result(msg["id"])
    bridge.task = hass.async_create_background_task(bridge.run(), f"{DOMAIN} audio")


def _owner(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, token: object
) -> AudioBridge:
    if not isinstance(token, str) or len(token) != 32:
        raise AudioError("audio_not_started")
    for bridge in hass.data[DOMAIN].get("audio_sessions", {}).values():
        if bridge.token == token and bridge.connection is connection and bridge.valid():
            if bridge.session is not None:
                return bridge
    raise AudioError("audio_not_started")


def packet_handler(operation: str) -> Any:
    @websocket_api.websocket_command(
        vol.All(vol.Schema({"type": f"{DOMAIN}/audio/{operation}"}, extra=vol.ALLOW_EXTRA))
    )
    @websocket_api.require_admin
    @websocket_api.async_response
    async def handle(
        hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
    ) -> None:
        try:
            fields = {"id", "type", "token"}
            if operation == "send":
                fields.update({"sequence", "data"})
            if set(msg) != fields:
                raise AudioError("audio_invalid_packet")
            bridge = _owner(hass, connection, msg.get("token"))
            session = bridge.session
            assert session is not None
            if operation == "receive":
                if bridge.receiving:
                    raise AudioError("audio_backpressure")
                bridge.receiving = True
                try:
                    packet = await session.receive()
                    if not bridge.valid():
                        raise AudioError("audio_not_started")
                    result = {
                        "format": "hikvision_intercom.audio",
                        "data": base64.b64encode(packet).decode("ascii"),
                    }
                finally:
                    bridge.receiving = False
            elif operation == "send":
                encoded = msg["data"]
                if (
                    type(msg["sequence"]) is not int
                    or msg["sequence"] != bridge.sequence
                    or not isinstance(encoded, str)
                    or len(encoded) != 1068
                ):
                    raise AudioError("audio_invalid_packet")
                try:
                    packet = base64.b64decode(encoded, validate=True)
                except (binascii.Error, ValueError):
                    raise AudioError("audio_invalid_packet") from None
                session.send(packet)
                bridge.sequence += 1
                result = {"sequence": bridge.sequence}
            elif operation == "diagnostics":
                result = {
                    "microphone_packets_accepted": bridge.sequence,
                    "microphone_bytes_written": session.microphone_bytes,
                    "total_bytes_written": session.sent_bytes,
                    "received_bytes": session.received_bytes,
                    "dropped_receive_packets": session.dropped_packets,
                    "physical_result": "unverified",
                }
            else:
                session.mute()
                result = {}
            bridge.touched = hass.loop.time()
            connection.send_result(msg["id"], result)
        except AudioError as err:
            connection.send_error(msg["id"], err.code, "Audio request could not complete")
        except Exception:
            connection.send_error(msg["id"], "audio_connection_lost", "Audio unavailable")

    return handle


@callback
def register_audio(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, start)
    for operation in ("send", "receive", "mute", "diagnostics"):
        websocket_api.async_register_command(hass, packet_handler(operation))
