"""Home Assistant websocket TTS playback ownership and safety."""

from __future__ import annotations

import asyncio
import io
import logging
import struct
import wave
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

from custom_components.hikvision_intercom.const import DOMAIN

from .test_websocket import request


@pytest.fixture
async def tts_player():
    class Driver:
        def __init__(self):
            self.failure = None
            self.close_confirmed = True
            self.microphone_bytes = 0
            self.start = AsyncMock()
            self.close = AsyncMock()
            self.packets = []

        def send(self, packet):
            self.packets.append(packet)
            self.microphone_bytes += len(packet)

    driver = Driver()
    synthesize = AsyncMock(return_value=([b"\xfe" * 800, b"\xfd" * 800], 0.2))
    engines = {
        "default": "tts.google_translate_en_com",
        "engines": [
            {
                "engine_id": "tts.google_translate_en_com",
                "name": "Google Translate",
                "supported_languages": ["en", "iw"],
                "default_language": "en",
            }
        ],
    }
    with (
        patch("custom_components.hikvision_intercom.audio_tts.AudioSession", return_value=driver),
        patch("custom_components.hikvision_intercom.audio_tts.synthesize", synthesize),
        patch(
            "custom_components.hikvision_intercom.audio_tts.available_engines",
            return_value=engines,
        ),
    ):
        yield driver, synthesize


async def start_tts(client, station, message="שלום מהכניסה"):
    return await request(
        client,
        "tts/start",
        station_id=station,
        engine_id="tts.google_translate_en_com",
        language="iw",
        message=message,
    )


@pytest.mark.parametrize("command", ["tts/engines", "tts/start"])
async def test_tts_requires_control_permission(
    hass, loaded_entry, hass_ws_client, hass_read_only_access_token, tts_player, command
):
    client = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    reply = await request(client, command)
    assert reply["error"]["code"] == "unauthorized"
    tts_player[0].start.assert_not_called()


async def test_tts_lists_configured_engine_without_provider_secrets(
    hass, loaded_entry, hass_ws_client, tts_player
):
    client = await hass_ws_client(hass)
    result = (await request(client, "tts/engines"))["result"]
    assert result["default"] == "tts.google_translate_en_com"
    assert result["engines"][0] == {
        "engine_id": "tts.google_translate_en_com",
        "name": "Google Translate",
        "supported_languages": ["en", "iw"],
        "default_language": "en",
    }
    assert "token" not in str(result).lower()


async def test_tts_generates_normalized_text_and_streams_only_to_selected_station(
    hass, loaded_entry, hass_ws_client, tts_player, device_io
):
    driver, synthesize = tts_player
    client = await hass_ws_client(hass)
    reply = await start_tts(client, loaded_entry.entry_id, "  שלום\n  מהכניסה  ")
    assert reply["success"]
    events = [(await asyncio.wait_for(client.receive_json(), 3))["event"] for _ in range(3)]
    assert [event["state"] for event in events] == ["generating", "speaking", "completed"]
    assert events[-1]["bytes_written"] == 1600
    assert events[-1]["physical_result"] == "unverified"
    synthesize.assert_awaited_once_with(hass, "tts.google_translate_en_com", "iw", "שלום מהכניסה")
    assert driver.packets == [b"\xfe" * 800, b"\xfd" * 800]
    driver.start.assert_awaited_once()
    driver.close.assert_awaited_once()
    assert not hass.data[DOMAIN]["tts_audio_sessions"]
    device_io["unlock"].assert_not_called()
    device_io["write_person"].assert_not_called()


@pytest.mark.parametrize(
    ("message", "code"),
    [("", "tts_invalid_message"), ("x" * 501, "tts_invalid_message")],
)
async def test_tts_rejects_invalid_text_before_generation(
    hass, loaded_entry, hass_ws_client, tts_player, message, code
):
    client = await hass_ws_client(hass)
    reply = await start_tts(client, loaded_entry.entry_id, message)
    assert reply["error"]["code"] == code
    tts_player[1].assert_not_awaited()
    tts_player[0].start.assert_not_called()


async def test_tts_rejects_unconfigured_engine_and_audio_conflicts(
    hass, loaded_entry, hass_ws_client, tts_player
):
    client = await hass_ws_client(hass)
    unavailable = await request(
        client,
        "tts/start",
        station_id=loaded_entry.entry_id,
        engine_id="tts.not_configured",
        language="iw",
        message="hello",
    )
    assert unavailable["error"]["code"] == "tts_engine_unavailable"
    hass.data[DOMAIN]["audio_sessions"] = {
        loaded_entry.entry_id: SimpleNamespace(connection=object())
    }
    try:
        busy = await start_tts(client, loaded_entry.entry_id)
        assert busy["error"]["code"] == "audio_busy"
        tts_player[0].start.assert_not_called()
    finally:
        hass.data[DOMAIN]["audio_sessions"].clear()


async def test_tts_disconnect_during_generation_cancels_and_releases_station(
    hass, loaded_entry, hass_ws_client, tts_player
):
    entered = asyncio.Event()

    async def wait_forever(*_args):
        entered.set()
        await asyncio.Event().wait()

    tts_player[1].side_effect = wait_forever
    client = await hass_ws_client(hass)
    assert (await start_tts(client, loaded_entry.entry_id))["success"]
    assert (await asyncio.wait_for(client.receive_json(), 3))["event"]["state"] == "generating"
    await entered.wait()
    playback = hass.data[DOMAIN]["tts_audio_sessions"][loaded_entry.entry_id]
    await client.close()
    await asyncio.wait_for(playback.task, 3)
    assert not hass.data[DOMAIN]["tts_audio_sessions"]
    tts_player[0].start.assert_not_called()


async def test_unload_cancels_tts_before_station_runtime_closes(
    hass, loaded_entry, hass_ws_client, tts_player
):
    gate = asyncio.Event()

    async def wait_forever(*_args):
        gate.set()
        await asyncio.Event().wait()

    tts_player[1].side_effect = wait_forever
    client = await hass_ws_client(hass)
    assert (await start_tts(client, loaded_entry.entry_id))["success"]
    await client.receive_json()
    await gate.wait()
    assert await hass.config_entries.async_unload(loaded_entry.entry_id)
    assert not hass.data[DOMAIN]["tts_audio_sessions"]


async def test_tts_message_and_provider_failure_do_not_leak_to_logs(
    hass, loaded_entry, hass_ws_client, tts_player, caplog
):
    secret = "PRIVATE ANNOUNCEMENT 482615"
    tts_player[1].side_effect = RuntimeError("provider included " + secret)
    caplog.set_level(logging.DEBUG)
    client = await hass_ws_client(hass)
    assert (await start_tts(client, loaded_entry.entry_id, secret))["success"]
    assert (await client.receive_json())["event"]["state"] == "generating"
    closed = await client.receive_json()
    assert closed["event"]["reason"] == "tts_playback_failed"
    assert secret not in caplog.text


async def test_home_assistant_tts_is_requested_as_8khz_mono_wave(hass):
    from custom_components.hikvision_intercom.audio_tts import synthesize

    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(8000)
        target.writeframes(struct.pack("<800h", *([1000] * 800)))
    generate = Mock(return_value="media-source://tts/generated")
    component = SimpleNamespace(
        generate_media_source_id=generate,
        async_get_media_source_audio=AsyncMock(return_value=("wav", output.getvalue())),
    )
    with patch(
        "custom_components.hikvision_intercom.audio_tts._tts_component",
        return_value=component,
    ):
        packets, duration = await synthesize(hass, "tts.google_translate_en_com", "iw", "בדיקה")
    assert len(packets) == 1 and len(packets[0]) == 800
    assert duration == 0.1
    assert generate.call_args.kwargs == {
        "engine": "tts.google_translate_en_com",
        "language": "iw",
        "options": {
            "preferred_format": "wav",
            "preferred_sample_rate": 8000,
            "preferred_sample_channels": 1,
            "preferred_sample_bytes": 2,
        },
        "cache": False,
    }


def test_missing_tts_runtime_keeps_engine_discovery_empty(hass):
    from custom_components.hikvision_intercom.audio_tts import available_engines

    with patch(
        "custom_components.hikvision_intercom.audio_tts._tts_component",
        side_effect=ImportError,
    ):
        assert available_engines(hass) == {"default": None, "engines": []}


async def test_missing_tts_runtime_is_a_bounded_generation_failure(hass):
    from custom_components.hikvision_intercom.audio_tts import IntercomTtsError, synthesize

    with (
        patch(
            "custom_components.hikvision_intercom.audio_tts._tts_component",
            side_effect=ImportError,
        ),
        pytest.raises(IntercomTtsError) as raised,
    ):
        await synthesize(hass, "tts.missing", "iw", "בדיקה")
    assert raised.value.code == "tts_generation_failed"
