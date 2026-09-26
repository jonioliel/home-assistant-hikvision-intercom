"""Real WebSocket authorization and durable shared appearance."""

from unittest.mock import AsyncMock, Mock

from custom_components.hikvision_intercom.appearance_settings import AppearanceSettings
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.storage import AccessStore

from .test_websocket import request


async def test_appearance_shared_after_reload(hass, loaded_entry, hass_ws_client):
    client = await hass_ws_client(hass)
    result = await request(client, "appearance/settings_update", revision=0, default="access-dark")
    assert result["success"]
    overview = await request(client, "overview")
    assert overview["result"]["appearance_settings"] == result["result"]
    restored = AppearanceSettings(AsyncMock(), Mock())
    restored.load(await AccessStore(hass, key=f"{DOMAIN}.appearance_settings").async_load())
    assert restored.public() == result["result"]
    conflict = await request(client, "appearance/settings_update", revision=0, default="modern")
    assert conflict["error"]["code"] == "revision_conflict"


async def test_delegated_manager_reads_default_but_cannot_change_it(
    hass, loaded_entry, hass_ws_client, hass_read_only_access_token, hass_read_only_user
):
    admin = await hass_ws_client(hass)
    areas = {area: "manage" for area in ("overview", "users", "events", "stations", "management")}
    await request(
        admin,
        "authorization/settings_update",
        revision=0,
        users={hass_read_only_user.id: {"enabled": True, "areas": areas}},
    )
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    assert (await request(reader, "appearance/settings_get"))["success"]
    denied = await request(reader, "appearance/settings_update", revision=0, default="access-light")
    assert denied["error"]["code"] == "unauthorized"
    assert (await request(admin, "appearance/settings_get"))["result"]["default"] == "current"
