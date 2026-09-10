"""Exercise real HA authorization, global persistence and binary MSE proxy ownership."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from aiohttp import web
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.media_settings import DEFAULTS, MediaSettings

from .test_websocket import request


async def test_global_settings_survive_reload_and_conflicting_admin(
    hass, loaded_entry, hass_ws_client
):
    client = await hass_ws_client(hass)
    other = await hass_ws_client(hass)
    original = await request(client, "media/settings_get")
    assert original["result"] == {"revision": 0, **DEFAULTS}
    values = {**DEFAULTS, "transport": "hls"}
    result = await request(client, "media/settings_update", revision=0, values=values)
    assert result["success"] and result["result"]["revision"] == 1
    conflict = await request(other, "media/settings_update", revision=0, values=DEFAULTS)
    assert conflict["error"]["code"] == "revision_conflict"
    overview = await request(other, "overview")
    assert overview["result"]["media_settings"] == result["result"]
    from custom_components.hikvision_intercom.storage import AccessStore

    loaded = MediaSettings(AsyncMock(), lambda: None)
    loaded.load(await AccessStore(hass, key=f"{DOMAIN}.media_settings").async_load())
    assert loaded.public() == result["result"]


@pytest.fixture
async def mse_server(hass, loaded_entry, socket_enabled, aiohttp_server):
    state = {"closed": asyncio.Event(), "sources": [], "error": False}

    async def socket(request):
        state["sources"].append(request.query["src"])
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        greeting = await ws.receive_json()
        assert greeting == {"type": "mse", "value": "avc1.640029"}
        if state["error"]:
            await ws.send_json(
                {"type": "error", "value": "rtsp://demo:demo-secret@192.0.2.10/secret"}
            )
        else:
            await ws.send_json({"type": "mse", "value": 'video/mp4; codecs="avc1.420029"'})
            await ws.send_bytes(b"synthetic-fmp4")
        async for _ in ws:
            pass
        state["closed"].set()
        return ws

    app = web.Application()
    app.router.add_get("/api/ws", socket)

    async def info(request):
        return web.json_response({"version": "test"})

    app.router.add_get("/api", info)
    server = await aiohttp_server(app)
    hass.data["go2rtc"] = SimpleNamespace(
        session=async_get_clientsession(hass), url=str(server.make_url(""))
    )
    await hass.data[DOMAIN]["media_settings"].update(0, {**DEFAULTS, "webrtc_mode": "mse"})
    return state


async def test_mse_signed_url_carries_binary_and_closes_upstream(
    hass, loaded_entry, mse_server, hass_client, hass_ws_client
):
    client = await hass_client(hass)
    socket = await hass_ws_client(hass)
    path = f"/api/{DOMAIN}/mse/{loaded_entry.entry_id}"
    unauth = await client.get(path)
    assert unauth.status == 401
    await socket.send_json_auto_id({"type": "auth/sign_path", "path": path, "expires": 30})
    signed = await socket.receive_json()
    assert signed["success"]
    ws = await client.ws_connect(signed["result"]["path"])
    await ws.send_json({"codecs": ["avc1.640029"]})
    reply = await asyncio.wait_for(ws.receive_json(), 3)
    assert reply == {"type": "mse", "value": 'video/mp4; codecs="avc1.420029"'}
    assert (await asyncio.wait_for(ws.receive(), 3)).data == b"synthetic-fmp4"
    assert len(mse_server["sources"]) == 1 and mse_server["sources"][0].startswith("rtsp://")
    await ws.close()
    await asyncio.wait_for(mse_server["closed"].wait(), 3)


@pytest.mark.parametrize("reason", ["settings", "upstream_error", "bad_handshake"])
async def test_mse_ends_on_changes_and_never_forwards_source_errors(
    hass, loaded_entry, mse_server, hass_client, hass_access_token, reason
):
    client = await hass_client(hass)
    mse_server["error"] = reason == "upstream_error"
    ws = await client.ws_connect(
        f"/api/{DOMAIN}/mse/{loaded_entry.entry_id}",
        headers={"Authorization": f"Bearer {hass_access_token}"},
    )
    await ws.send_json({"codecs": ["invalid" if reason == "bad_handshake" else "avc1.640029"]})
    if reason == "settings":
        await ws.receive_json()
        await ws.receive()
        await hass.data[DOMAIN]["media_settings"].update(1, {**DEFAULTS, "transport": "hls"})
    result = await asyncio.wait_for(ws.receive_json(), 3)
    assert result["type"] == "error" and result["code"].startswith("mse_")
    assert "demo-secret" not in json.dumps(result) and "rtsp" not in json.dumps(result)
    await ws.close()
    if reason != "bad_handshake":
        await asyncio.wait_for(mse_server["closed"].wait(), 3)
    else:
        assert not mse_server["sources"]


async def test_mse_rejects_reader_and_hls_mode(
    hass, loaded_entry, hass_client, hass_read_only_access_token, hass_access_token
):
    client = await hass_client(hass)
    path = f"/api/{DOMAIN}/mse/{loaded_entry.entry_id}"
    assert (
        await client.get(path, headers={"Authorization": f"Bearer {hass_read_only_access_token}"})
    ).status == 403
    assert (
        await client.get(path, headers={"Authorization": f"Bearer {hass_access_token}"})
    ).status == 409


async def test_provider_check_missing_and_available(hass, loaded_entry, hass_ws_client, mse_server):
    client = await hass_ws_client(hass)
    result = await request(client, "media/provider_check")
    assert result["result"] == {"available": True, "source": "home_assistant"}
    hass.data.pop("go2rtc")
    assert (await request(client, "media/provider_check"))["error"][
        "code"
    ] == "mse_provider_unavailable"
