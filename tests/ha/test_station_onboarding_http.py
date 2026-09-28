"""Native HTTP setup flow serialization used by the station sequence wizard."""

from dataclasses import replace
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.setup import async_setup_component

from custom_components.hikvision_intercom.const import DOMAIN

from .conftest import DATA, PROFILE


@pytest.fixture(autouse=True)
def no_entry_setup():
    with patch(
        "custom_components.hikvision_intercom.async_setup_entry", AsyncMock(return_value=True)
    ):
        yield


async def post(client, token, path, values):
    response = await client.post(
        "/api/config/config_entries/" + path,
        json=values,
        headers={"Authorization": "Bearer " + token},
    )
    assert response.status == 200
    return await response.json()


async def test_native_flow_schema_identity_and_deliberate_relay_confirmation(
    hass, device_io, hass_client, hass_access_token
):
    assert await async_setup_component(hass, "config", {})
    client = await hass_client(hass)
    flow = await post(client, hass_access_token, "flow", {"handler": DOMAIN})
    assert flow["step_id"] == "user"
    flow_id = flow["flow_id"]
    fields = {field["name"]: field for field in flow["data_schema"]}
    assert {
        "host",
        "name",
        "username",
        "password",
        "scheme",
        "port",
        "rtsp_port",
        "verify_ssl",
    } <= fields.keys()
    assert "default" not in fields["password"]
    flow = await post(
        client,
        hass_access_token,
        "flow/" + flow_id,
        {k: v for k, v in DATA.items() if k != "locks"},
    )
    assert flow["step_id"] == "confirm_device"
    assert flow["description_placeholders"]["model"] == PROFILE.model
    flow = await post(client, hass_access_token, "flow/" + flow_id, {})
    fields = {field["name"]: field for field in flow["data_schema"]}
    assert fields["mode"]["selector"]["select"]["options"] == ["camera_only", "map_active_relay"]
    flow = await post(
        client,
        hass_access_token,
        "flow/" + flow_id,
        {"mode": "map_active_relay", "lock_name": "Verified door"},
    )
    assert flow["step_id"] == "mapping"
    fields = {field["name"]: field for field in flow["data_schema"]}
    assert fields["api_id"]["options"] == [[1, 1], [2, 2]]
    device_io["unlock"].assert_not_called()
    flow = await post(
        client, hass_access_token, "flow/" + flow_id, {"api_id": 1, "test_unlock": False}
    )
    assert flow["errors"]["base"] == "test_required"
    device_io["unlock"].assert_not_called()
    flow = await post(
        client, hass_access_token, "flow/" + flow_id, {"api_id": 1, "test_unlock": True}
    )
    assert flow["step_id"] == "confirm_mapping"
    device_io["unlock"].assert_awaited_once_with(1)
    assert not hass.config_entries.async_entries(DOMAIN)
    flow = await post(
        client, hass_access_token, "flow/" + flow_id, {"result": "released_and_returned"}
    )
    assert flow["type"] == "create_entry"
    entries = hass.config_entries.async_entries(DOMAIN)
    assert len(entries) == 1 and entries[0].unique_id == PROFILE.unique_id
    assert entries[0].data["locks"][0]["name"] == "Verified door"
    await hass.async_block_till_done()


async def test_native_flow_duplicate_failure_does_not_reserve_next_identity(
    hass, device_io, hass_client, hass_access_token
):
    assert await async_setup_component(hass, "config", {})
    client = await hass_client(hass)
    first = await post(client, hass_access_token, "flow", {"handler": DOMAIN})
    path = "flow/" + first["flow_id"]
    await post(client, hass_access_token, path, {k: v for k, v in DATA.items() if k != "locks"})
    await post(client, hass_access_token, path, {})
    await post(client, hass_access_token, path, {"mode": "camera_only"})
    second = await post(client, hass_access_token, "flow", {"handler": DOMAIN})
    result = await post(
        client,
        hass_access_token,
        "flow/" + second["flow_id"],
        {k: v for k, v in DATA.items() if k != "locks"},
    )
    assert result["type"] == "abort" and result["reason"] == "already_configured"
    device_io["profile"].return_value = replace(
        PROFILE, unique_id="NEXT-IDENTITY", serial="NEXT-IDENTITY"
    )
    third = await post(client, hass_access_token, "flow", {"handler": DOMAIN})
    path = "flow/" + third["flow_id"]
    result = await post(
        client,
        hass_access_token,
        path,
        {**{k: v for k, v in DATA.items() if k != "locks"}, "host": "192.0.2.11"},
    )
    assert result["step_id"] == "confirm_device"
    response = await client.delete(
        "/api/config/config_entries/" + path,
        headers={"Authorization": "Bearer " + hass_access_token},
    )
    assert response.status == 200
    assert len(hass.config_entries.async_entries(DOMAIN)) == 1
    device_io["unlock"].assert_not_called()
    await hass.async_block_till_done()


async def test_native_setup_http_requires_administrator(
    hass, device_io, hass_client, hass_read_only_access_token
):
    assert await async_setup_component(hass, "config", {})
    client = await hass_client(hass)
    response = await client.post(
        "/api/config/config_entries/flow",
        json={"handler": DOMAIN},
        headers={"Authorization": "Bearer " + hass_read_only_access_token},
    )
    assert response.status == 403
    device_io["profile"].assert_not_called()
    device_io["unlock"].assert_not_called()
