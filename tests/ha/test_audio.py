"""Real HA websocket audio ownership, authorization and teardown."""

import asyncio
import base64
import json
import logging
from unittest.mock import AsyncMock, patch

import pytest

from custom_components.hikvision_intercom.client.audio import AudioError
from custom_components.hikvision_intercom.const import DOMAIN

from .test_websocket import request


@pytest.fixture
async def audio_driver():
    class Driver:
        failure = None
        close_confirmed = True
        received_bytes = 800
        sent_bytes = 160
        start = AsyncMock()
        close = AsyncMock()
        receive = AsyncMock(return_value=b"\xff" * 800)

        def __init__(self):
            self.packets = []
            self.mutes = 0

        def send(self, packet):
            self.packets.append(packet)

        def mute(self):
            self.mutes += 1

    driver = Driver()
    with patch("custom_components.hikvision_intercom.audio_api.AudioSession", return_value=driver):
        yield driver


async def started(client, station):
    result = await request(client, "audio/start", station_id=station)
    assert result["success"]
    ready = await asyncio.wait_for(client.receive_json(), 3)
    assert ready["event"]["state"] == "ready"
    return result["id"], ready["event"]["token"]


@pytest.mark.parametrize("command", ["start", "send", "receive", "mute"])
async def test_audio_requires_admin(
    hass, loaded_entry, hass_ws_client, hass_read_only_access_token, command, audio_driver
):
    client = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    reply = await request(client, "audio/" + command)
    assert reply["error"]["code"] == "unauthorized"
    audio_driver.start.assert_not_called()


async def test_audio_roundtrip_is_connection_owned_and_does_not_unlock(
    hass, loaded_entry, hass_ws_client, audio_driver, device_io
):
    client = await hass_ws_client(hass)
    other = await hass_ws_client(hass)
    subscription, token = await started(client, loaded_entry.entry_id)
    denied = await request(other, "audio/receive", token=token)
    assert denied["error"]["code"] == "audio_not_started"
    incoming = await request(client, "audio/receive", token=token)
    assert base64.b64decode(incoming["result"]["data"]) == b"\xff" * 800
    sent = await request(
        client, "audio/send", token=token, sequence=0, data=base64.b64encode(b"\xfe" * 800).decode()
    )
    assert sent["result"]["sequence"] == 1 and audio_driver.packets == [b"\xfe" * 800]
    duplicate = await request(
        client, "audio/send", token=token, sequence=0, data=base64.b64encode(b"\xfe" * 800).decode()
    )
    assert duplicate["error"]["code"] == "audio_invalid_packet"
    assert (await request(client, "audio/mute", token=token))["success"]
    assert audio_driver.mutes == 1
    device_io["unlock"].assert_not_called()
    device_io["write_person"].assert_not_called()
    await client.send_json_auto_id({"type": "unsubscribe_events", "subscription": subscription})
    assert (await client.receive_json())["success"]
    await hass.async_block_till_done()
    audio_driver.close.assert_awaited_once()
    assert not hass.data[DOMAIN]["audio_sessions"]


async def test_same_station_and_same_browser_cannot_take_audio_twice(
    hass, loaded_entry, hass_ws_client, audio_driver
):
    client = await hass_ws_client(hass)
    other = await hass_ws_client(hass)
    await started(client, loaded_entry.entry_id)
    assert (await request(other, "audio/start", station_id=loaded_entry.entry_id))["error"][
        "code"
    ] == "audio_busy"
    assert (await request(client, "audio/start", station_id=loaded_entry.entry_id))["error"][
        "code"
    ] == "audio_busy"
    await client.close()
    await hass.async_block_till_done()
    assert not hass.data[DOMAIN]["audio_sessions"]
    audio_driver.close.assert_awaited_once()


async def test_unload_closes_audio_before_runtime_connection(
    hass, loaded_entry, hass_ws_client, audio_driver
):
    client = await hass_ws_client(hass)
    await started(client, loaded_entry.entry_id)

    async def close():
        assert not loaded_entry.runtime_data.session.is_closed

    audio_driver.close.side_effect = close
    assert await hass.config_entries.async_unload(loaded_entry.entry_id)
    closed = await asyncio.wait_for(client.receive_json(), 3)
    assert closed["event"]["state"] == "closed"
    assert not hass.data[DOMAIN]["audio_sessions"]
    audio_driver.close.assert_awaited_once()


async def test_start_failure_closes_and_releases_reservation(
    hass, loaded_entry, hass_ws_client, audio_driver
):
    client = await hass_ws_client(hass)
    audio_driver.start.side_effect = AudioError("audio_unsupported")
    assert (await request(client, "audio/start", station_id=loaded_entry.entry_id))["success"]
    event = await asyncio.wait_for(client.receive_json(), 3)
    assert event["event"]["reason"] == "audio_unsupported"
    assert not hass.data[DOMAIN]["audio_sessions"]
    audio_driver.close.assert_awaited_once()


async def test_revoke_admin_during_receive_does_not_return_audio(
    hass, loaded_entry, hass_ws_client, audio_driver
):
    client = await hass_ws_client(hass)
    _, token = await started(client, loaded_entry.entry_id)
    bridge = hass.data[DOMAIN]["audio_sessions"][loaded_entry.entry_id]

    async def receive():
        bridge.connection.user.groups = []
        return b"\xff" * 800

    audio_driver.receive.side_effect = receive
    reply = await request(client, "audio/receive", token=token)
    assert reply["error"]["code"] == "audio_not_started"
    assert "data" not in reply
    bridge.task.cancel()
    await bridge.task


async def test_concurrent_receive_is_bounded(hass, loaded_entry, hass_ws_client, audio_driver):
    client = await hass_ws_client(hass)
    _, token = await started(client, loaded_entry.entry_id)
    gate = asyncio.Event()
    entered = asyncio.Event()

    async def receive():
        entered.set()
        await gate.wait()
        return b"\xff" * 800

    audio_driver.receive.side_effect = receive
    await client.send_json_auto_id({"type": DOMAIN + "/audio/receive", "token": token})
    await entered.wait()
    second = await request(client, "audio/receive", token=token)
    assert second["error"]["code"] == "audio_backpressure"
    gate.set()
    assert (await client.receive_json())["success"]


async def test_packets_and_tokens_do_not_leak_to_debug_log(
    hass, loaded_entry, hass_ws_client, audio_driver, caplog
):
    caplog.set_level(logging.DEBUG, logger="homeassistant.components.websocket_api.http.connection")
    client = await hass_ws_client(hass)
    _, token = await started(client, loaded_entry.entry_id)
    reply = await request(
        client, "audio/send", token=token, sequence=True, data="PRIVATE_AUDIO_PAYLOAD"
    )
    assert reply["error"]["code"] == "audio_invalid_packet"
    assert "PRIVATE_AUDIO_PAYLOAD" not in caplog.text + json.dumps(reply)
    assert token not in caplog.text
    assert audio_driver.packets == []


async def test_disconnect_while_opening_still_closes_owned_session(
    hass, loaded_entry, hass_ws_client, audio_driver
):
    client = await hass_ws_client(hass)
    entered = asyncio.Event()

    async def opening():
        entered.set()
        await asyncio.Event().wait()

    audio_driver.start.side_effect = opening
    assert (await request(client, "audio/start", station_id=loaded_entry.entry_id))["success"]
    await entered.wait()
    bridge = hass.data[DOMAIN]["audio_sessions"][loaded_entry.entry_id]
    await client.close()
    await asyncio.wait_for(bridge.task, 3)
    audio_driver.close.assert_awaited_once()
    assert not hass.data[DOMAIN]["audio_sessions"]


@pytest.mark.parametrize(
    "limit,reason", [("MAX_SECONDS", "audio_expired"), ("IDLE_SECONDS", "audio_idle_timeout")]
)
async def test_audio_server_enforces_lifetime_even_when_browser_stalls(
    hass, loaded_entry, hass_ws_client, audio_driver, limit, reason
):
    client = await hass_ws_client(hass)
    with patch("custom_components.hikvision_intercom.audio_api." + limit, 0.01):
        await started(client, loaded_entry.entry_id)
        result = await asyncio.wait_for(client.receive_json(), 3)
    assert result["event"]["reason"] == reason
    assert not hass.data[DOMAIN]["audio_sessions"]
    audio_driver.close.assert_awaited_once()


async def test_audio_nine_station_runtime_isolates_sessions_and_door_actions(
    hass, device_io, hass_ws_client
):
    from dataclasses import replace
    from types import SimpleNamespace

    from pytest_homeassistant_custom_component.common import MockConfigEntry

    from custom_components.hikvision_intercom.event_manager import get_events

    from .conftest import DATA, PROFILE
    from .test_events import live

    async def profile(client):
        return replace(
            PROFILE, unique_id=client._expected_identity, serial=client._expected_identity
        )

    async def info(client):
        return client._expected_identity, PROFILE.model, PROFILE.firmware, client._expected_identity

    drivers = {}

    def factory(client):
        driver = SimpleNamespace(
            failure=None,
            close_confirmed=True,
            received_bytes=800,
            sent_bytes=160,
            start=AsyncMock(),
            close=AsyncMock(),
            receive=AsyncMock(return_value=b"\xff" * 800),
            send=lambda p: None,
            mute=lambda: None,
        )
        drivers[client._expected_identity] = driver
        return driver

    entries = []
    clients = []
    with (
        patch(
            "custom_components.hikvision_intercom.client.client.HikvisionClient.async_profile",
            profile,
        ),
        patch(
            "custom_components.hikvision_intercom.client.client.HikvisionClient.async_device_info",
            info,
        ),
        patch("custom_components.hikvision_intercom.audio_api.AudioSession", factory),
    ):
        try:
            for index in range(9):
                entry = MockConfigEntry(
                    domain=DOMAIN,
                    title=f"Audio station {index}",
                    unique_id=f"AUDIO-{index}",
                    data={**DATA, "host": f"192.0.2.{index + 1}"},
                )
                entry.add_to_hass(hass)
                assert await hass.config_entries.async_setup(entry.entry_id)
                entries.append(entry)
            clients = [await hass_ws_client(hass) for _ in range(4)]
            for index in range(3):
                await started(clients[index], entries[index].entry_id)
            blocked = await request(clients[3], "audio/start", station_id=entries[3].entry_id)
            assert blocked["error"]["code"] == "audio_busy"
            drivers["AUDIO-0"].failure = "audio_connection_lost"
            event = await asyncio.wait_for(clients[0].receive_json(), 3)
            assert event["event"]["reason"] == "audio_connection_lost"
            assert len(hass.data[DOMAIN]["audio_sessions"]) == 2
            released = await request(
                clients[3], "stations/test_unlock", station_id=entries[8].entry_id, lock=1
            )
            assert released["success"]
            device_io["unlock"].assert_awaited_once_with(1)
            for index, entry in enumerate(entries):
                entry.runtime_data.events.ingest(
                    live(181, serialNo=8000 + index, employeeNoString=f"RESIDENT-{index}")
                )
            assert len(get_events(hass).query({})["records"]) == 9
            await started(clients[0], entries[3].entry_id)
            assert len(hass.data[DOMAIN]["audio_sessions"]) == 3
            assert await hass.config_entries.async_unload(entries[1].entry_id)
            assert (await clients[1].receive_json())["event"]["state"] == "closed"
            assert entries[2].entry_id in hass.data[DOMAIN]["audio_sessions"]
            drivers["AUDIO-2"].close.assert_not_called()
        finally:
            for client in clients:
                await client.close()
            tasks = [
                bridge.task
                for bridge in hass.data.get(DOMAIN, {}).get("audio_sessions", {}).values()
                if bridge.task
            ]
            await asyncio.gather(*tasks, return_exceptions=True)
            for entry in reversed(entries):
                if not entry.runtime_data.session.is_closed:
                    await hass.config_entries.async_unload(entry.entry_id)
            await hass.async_block_till_done()
