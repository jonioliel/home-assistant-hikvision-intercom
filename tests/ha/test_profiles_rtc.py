"""Run the real HA go2rtc bridge with a loopback signaling server."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from aiohttp import web
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.media_settings import DEFAULTS

from .test_websocket import request

OFFER = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=recvonly\r\n"


@pytest.fixture
async def rtc_server(hass, loaded_entry, socket_enabled, aiohttp_server):
    state = {"sources": [], "candidates": [], "closed": asyncio.Event(), "error": False}

    async def socket(request):
        state["sources"].append(request.query["src"])
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        assert await ws.receive_json() == {"type": "webrtc/offer", "value": OFFER}
        if state["error"]:
            await ws.send_json(
                {"type": "error", "value": "rtsp://demo:demo-secret@192.0.2.10/secret"}
            )
        else:
            await ws.send_json({"type": "webrtc/answer", "value": "v=0\r\nsynthetic answer"})
            await ws.send_json({"type": "webrtc/candidate", "value": "candidate:synthetic"})
        async for msg in ws:
            state["candidates"].append(json.loads(msg.data))
        state["closed"].set()
        return ws

    app = web.Application()
    app.router.add_get("/api/ws", socket)
    server = await aiohttp_server(app)
    state["url"] = str(server.make_url(""))
    await hass.data[DOMAIN]["media_settings"].update(0, {**DEFAULTS, "go2rtc_url": state["url"]})
    # An unusable native provider proves the explicitly selected add-on takes priority.
    hass.data["go2rtc"] = SimpleNamespace(
        session=async_get_clientsession(hass), url="http://invalid.test"
    )
    yield state
    await asyncio.wait_for(hass.data[DOMAIN]["rtc_view"].finished.wait(), 3)


async def test_rtc_signed_path_routes_selected_addon_and_closes(
    hass, loaded_entry, rtc_server, hass_client, hass_ws_client
):
    client = await hass_client(hass)
    commands = await hass_ws_client(hass)
    path = f"/api/{DOMAIN}/rtc/{loaded_entry.entry_id}"
    assert (await client.get(path)).status == 401
    await commands.send_json_auto_id({"type": "auth/sign_path", "path": path, "expires": 30})
    signed = await commands.receive_json()
    ws = await client.ws_connect(signed["result"]["path"])
    await ws.send_json({"offer": OFFER})
    assert (await ws.receive_json())["type"] == "answer"
    assert (await ws.receive_json())["candidate"]["sdpMid"] == "0"
    await ws.send_json({"candidate": "candidate:browser"})
    await ws.send_json({"type": "ping"})
    assert await ws.receive_json() == {"type": "pong"}
    await ws.close()
    await asyncio.wait_for(rtc_server["closed"].wait(), 3)
    assert rtc_server["sources"][0].startswith("rtsp://")
    assert rtc_server["candidates"] == [{"type": "webrtc/candidate", "value": "candidate:browser"}]


@pytest.mark.parametrize("reason", ["send_audio", "upstream_error", "settings", "owner"])
async def test_rtc_rejects_publishing_masks_errors_and_revokes(
    hass, loaded_entry, rtc_server, hass_client, hass_access_token, reason
):
    client = await hass_client(hass)
    rtc_server["error"] = reason == "upstream_error"
    ws = await client.ws_connect(
        f"/api/{DOMAIN}/rtc/{loaded_entry.entry_id}",
        headers={"Authorization": f"Bearer {hass_access_token}"},
    )
    await ws.send_json(
        {"offer": OFFER.replace("recvonly", "sendrecv") if reason == "send_audio" else OFFER}
    )
    if reason in {"settings", "owner"}:
        await ws.receive_json()
        await ws.receive_json()
        if reason == "settings":
            await hass.data[DOMAIN]["media_settings"].update(1, {**DEFAULTS, "transport": "hls"})
        else:
            runtime = loaded_entry.runtime_data
            loaded_entry.runtime_data = None
    result = await asyncio.wait_for(ws.receive_json(), 3)
    assert result["type"] == "error"
    assert "demo-secret" not in json.dumps(result) and "rtsp" not in json.dumps(result)
    await ws.close()
    if reason == "owner":
        loaded_entry.runtime_data = runtime
    if reason != "send_audio":
        await asyncio.wait_for(rtc_server["closed"].wait(), 3)
    else:
        assert not rtc_server["sources"]


async def test_rtc_reader_denied(
    hass, loaded_entry, rtc_server, hass_client, hass_read_only_access_token
):
    client = await hass_client(hass)
    result = await client.get(
        f"/api/{DOMAIN}/rtc/{loaded_entry.entry_id}",
        headers={"Authorization": f"Bearer {hass_read_only_access_token}"},
    )
    assert result.status == 403 and not rtc_server["sources"]


async def test_profiles_admin_persistence_photo_projection(
    hass, loaded_entry, hass_ws_client, hass_read_only_access_token
):
    from tests.test_profiles import PHOTO, VALUES

    client = await hass_ws_client(hass)
    saved = await request(client, "profiles/settings_update", revision=0, values=VALUES)
    assert saved["success"]
    user = await request(
        client,
        "users/create",
        data={
            "display_name": "Demo",
            "profile": {"department": "Staff"},
            "group_ids": ["team"],
            "photo": PHOTO,
        },
        sync_now=False,
    )
    assert user["success"] and "photo" not in user["result"] and user["result"]["photo_configured"]
    uid = user["result"]["id"]
    assert (await request(client, "users/photo_get", user_id=uid))["result"] == {"photo": PHOTO}
    assert PHOTO not in json.dumps((await request(client, "overview"))["result"])
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    assert not (await request(reader, "users/photo_get", user_id=uid))["success"]
    assert not (await request(reader, "profiles/settings_update", revision=1, values=VALUES))[
        "success"
    ]
    assert (
        await request(
            client,
            "profiles/settings_update",
            revision=1,
            values={**VALUES, "photo_enabled": False},
        )
    )["success"]
    assert (await request(client, "users/photo_get", user_id=uid))["result"] == {"photo": None}
