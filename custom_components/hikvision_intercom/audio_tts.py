"""Home Assistant TTS playback through the verified ISAPI talk channel."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .client.audio import AudioError, AudioSession
from .client.tts_audio import TtsCodecError, wav_to_mulaw_packets
from .const import DOMAIN
from .exceptions import HikvisionError
from .panel_permissions import area_allowed

MAX_TEXT_LENGTH = 500
SYNTHESIS_TIMEOUT = 30
MAX_CONCURRENT_AUDIO = 3


def _tts_component() -> Any:
    """Load HA TTS only when used so WisKey still starts without a TTS provider."""

    from homeassistant.components import tts

    return tts


class IntercomTtsError(Exception):
    """Allowlisted TTS failure safe to expose to the panel."""

    def __init__(self, code: str) -> None:
        super().__init__("Intercom TTS could not complete")
        self.code = code


def _authorized(hass: HomeAssistant, user: Any) -> bool:
    permissions = hass.data[DOMAIN].get("panel_permissions")
    return area_allowed(permissions, user, "overview", "manage") or area_allowed(
        permissions, user, "stations", "manage"
    )


def normalize_message(value: object) -> str:
    """Return bounded natural-language text without retaining control whitespace."""

    if not isinstance(value, str):
        raise IntercomTtsError("tts_invalid_message")
    message = " ".join(value.split())
    if not message or len(message) > MAX_TEXT_LENGTH:
        raise IntercomTtsError("tts_invalid_message")
    return message


def available_engines(hass: HomeAssistant) -> dict[str, Any]:
    """Return configured HA TTS engines without exposing provider configuration."""

    try:
        tts_component = _tts_component()
        default = tts_component.async_default_engine(hass)
    except (ImportError, KeyError, TypeError):
        return {"default": None, "engines": []}
    engine_ids = list(hass.states.async_entity_ids("tts"))
    if default and default not in engine_ids:
        engine_ids.append(default)
    engines: list[dict[str, Any]] = []
    try:
        from homeassistant.components.tts.helper import get_engine_instance
    except ImportError:
        get_engine_instance = None
    for engine_id in engine_ids:
        instance = get_engine_instance(hass, engine_id) if get_engine_instance else None
        state = hass.states.get(engine_id)
        languages = getattr(instance, "supported_languages", None)
        default_language = getattr(instance, "default_language", None)
        engines.append(
            {
                "engine_id": engine_id,
                "name": (state.attributes.get("friendly_name") if state else None) or engine_id,
                "supported_languages": sorted(languages) if languages else [],
                "default_language": default_language if isinstance(default_language, str) else None,
            }
        )
    engines.sort(key=lambda row: (row["engine_id"] != default, row["name"].casefold()))
    return {"default": default, "engines": engines}


async def synthesize(
    hass: HomeAssistant, engine: str, language: str | None, message: str
) -> tuple[list[bytes], float]:
    """Generate a preferred HA TTS stream and transcode it to the device codec."""

    try:
        tts_component = _tts_component()
        media_source_id = tts_component.generate_media_source_id(
            hass,
            message,
            engine=engine,
            language=language,
            options={
                "preferred_format": "wav",
                "preferred_sample_rate": 8000,
                "preferred_sample_channels": 1,
                "preferred_sample_bytes": 2,
            },
            cache=False,
        )
        extension, data = await asyncio.wait_for(
            tts_component.async_get_media_source_audio(hass, media_source_id),
            SYNTHESIS_TIMEOUT,
        )
    except TimeoutError:
        raise IntercomTtsError("tts_generation_timeout") from None
    except Exception:
        # Provider text, URLs, credentials and response bodies are deliberately not logged.
        raise IntercomTtsError("tts_generation_failed") from None
    if extension.lower().lstrip(".") != "wav" or not isinstance(data, bytes):
        raise IntercomTtsError("tts_audio_format")
    return await hass.async_add_executor_job(wav_to_mulaw_packets, data)


@dataclass(eq=False)
class TtsPlayback:
    """One connection-owned, cancellable announcement to one station."""

    hass: HomeAssistant
    connection: websocket_api.ActiveConnection
    runtime: Any
    subscription: int
    engine: str
    language: str | None
    message: str
    token: str = field(default_factory=lambda: uuid4().hex)
    session: AudioSession | None = None
    task: asyncio.Task[None] | None = None
    stopped: bool = False
    entered: bool = False

    def valid(self) -> bool:
        entry = self.hass.config_entries.async_get_entry(self.runtime.station_id)
        return bool(
            not self.stopped
            and _authorized(self.hass, self.connection.user)
            and entry
            and getattr(entry, "runtime_data", None) is self.runtime
            and not self.runtime.is_closed
            and self.subscription in self.connection.subscriptions
        )

    def send_event(self, payload: dict[str, Any]) -> None:
        if self.subscription in self.connection.subscriptions and _authorized(
            self.hass, self.connection.user
        ):
            self.connection.send_event(
                self.subscription,
                {"format": "hikvision_intercom.tts", **payload},
            )

    @callback
    def cancel(self) -> None:
        if self.stopped:
            return
        self.stopped = True
        if not self.entered:
            sessions = self.hass.data.get(DOMAIN, {}).get("tts_audio_sessions", {})
            if sessions.get(self.runtime.station_id) is self:
                sessions.pop(self.runtime.station_id, None)
            self.connection.subscriptions.pop(self.subscription, None)
        if self.task:
            self.task.cancel()

    async def run(self) -> None:
        self.entered = True
        outcome = "tts_cancelled"
        completed = False
        try:
            self.send_event({"state": "generating"})
            packets, duration = await synthesize(
                self.hass, self.engine, self.language, self.message
            )
            if not self.valid():
                return
            construction = self.hass.async_add_executor_job(AudioSession, self.runtime.client)
            try:
                self.session = await asyncio.shield(construction)
            except asyncio.CancelledError:
                self.session = await construction
                raise
            await self.session.start()
            if not self.valid():
                return
            self.send_event(
                {
                    "state": "speaking",
                    "duration_seconds": round(duration, 2),
                    "packet_count": len(packets),
                }
            )
            for packet in packets:
                if not self.valid():
                    return
                if self.session.failure:
                    raise AudioError(self.session.failure)
                self.session.send(packet)
                await asyncio.sleep(0.1)
            await asyncio.sleep(0.15)
            if not self.valid():
                return
            completed = True
            outcome = "completed"
            self.send_event(
                {
                    "state": "completed",
                    "duration_seconds": round(duration, 2),
                    "bytes_written": self.session.microphone_bytes,
                    "physical_result": "unverified",
                }
            )
        except asyncio.CancelledError:
            pass
        except (IntercomTtsError, TtsCodecError) as err:
            outcome = err.code
        except AudioError as err:
            outcome = err.code
        except (HikvisionError, TimeoutError, OSError):
            outcome = "audio_connection_lost"
        except Exception:
            outcome = "tts_playback_failed"
        finally:
            self.stopped = True
            if self.session:
                try:
                    await self.session.close()
                except Exception:
                    pass
            sessions = self.hass.data.get(DOMAIN, {}).get("tts_audio_sessions", {})
            if sessions.get(self.runtime.station_id) is self:
                sessions.pop(self.runtime.station_id, None)
            if self.subscription in self.connection.subscriptions:
                if not completed and _authorized(self.hass, self.connection.user):
                    self.connection.send_event(
                        self.subscription,
                        {
                            "format": "hikvision_intercom.tts",
                            "state": "closed",
                            "reason": outcome,
                        },
                    )
                self.connection.subscriptions.pop(self.subscription, None)


@websocket_api.websocket_command(
    vol.All(vol.Schema({"type": f"{DOMAIN}/tts/engines"}, extra=vol.ALLOW_EXTRA))
)
@callback
def engines(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    if not _authorized(hass, connection.user):
        connection.send_error(msg["id"], "unauthorized", "WisKey control access is not granted")
        return
    if set(msg) != {"id", "type"}:
        connection.send_error(msg["id"], "invalid_fields", "Invalid TTS request")
        return
    connection.send_result(msg["id"], available_engines(hass))


@websocket_api.websocket_command(
    vol.All(vol.Schema({"type": f"{DOMAIN}/tts/start"}, extra=vol.ALLOW_EXTRA))
)
@callback
def start(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    if not _authorized(hass, connection.user):
        connection.send_error(msg["id"], "unauthorized", "WisKey control access is not granted")
        return
    allowed = {"id", "type", "station_id", "engine_id", "language", "message"}
    station = msg.get("station_id")
    engine = msg.get("engine_id")
    language = msg.get("language")
    try:
        message = normalize_message(msg.get("message"))
    except IntercomTtsError as err:
        connection.send_error(msg["id"], err.code, "Invalid TTS message")
        return
    if (
        set(msg) != allowed
        or not isinstance(station, str)
        or not 1 <= len(station) <= 128
        or not isinstance(engine, str)
        or not 1 <= len(engine) <= 128
        or (language is not None and (not isinstance(language, str) or len(language) > 64))
    ):
        connection.send_error(msg["id"], "invalid_fields", "Invalid TTS request")
        return
    configured = available_engines(hass)
    if engine not in {row["engine_id"] for row in configured["engines"]}:
        connection.send_error(msg["id"], "tts_engine_unavailable", "TTS engine unavailable")
        return
    entry = hass.config_entries.async_get_entry(station)
    runtime = getattr(entry, "runtime_data", None) if entry and entry.domain == DOMAIN else None
    if runtime is None or runtime.is_closed:
        connection.send_error(msg["id"], "station_unloaded", "Station unavailable")
        return
    audio_sessions = hass.data[DOMAIN].setdefault("audio_sessions", {})
    tts_sessions = hass.data[DOMAIN].setdefault("tts_audio_sessions", {})
    all_sessions = [*audio_sessions.values(), *tts_sessions.values()]
    if (
        station in audio_sessions
        or station in tts_sessions
        or len(all_sessions) >= MAX_CONCURRENT_AUDIO
        or any(item.connection is connection for item in all_sessions)
    ):
        connection.send_error(msg["id"], "audio_busy", "Audio is already in use")
        return
    playback = TtsPlayback(
        hass,
        connection,
        runtime,
        msg["id"],
        engine,
        language or None,
        message,
    )
    tts_sessions[station] = playback
    connection.subscriptions[msg["id"]] = playback.cancel
    connection.send_result(msg["id"])
    playback.task = hass.async_create_background_task(playback.run(), f"{DOMAIN} tts")


@callback
def register_tts_audio(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, engines)
    websocket_api.async_register_command(hass, start)
