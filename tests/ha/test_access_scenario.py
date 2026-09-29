"""Actual authenticated transport: no writes, field and station scopes enforced."""

import json

from custom_components.hikvision_intercom.access_runtime import get_manager
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.panel_permissions import AREAS, FIELDS

from .test_websocket import request


async def scenario(client, uid, sid, at="2026-09-29T12:00:00+03:00"):
    return await request(
        client, "users/access_scenario", user_id=uid, station_id=sid, lock_id=1, at=at
    )


async def test_scenario_real_transport_is_read_only(hass, loaded_entry, hass_ws_client, device_io):
    manager = get_manager(hass)
    person = await manager.repository.async_create(
        {
            "display_name": "Scenario",
            "pin": "827461",
            "assignments": {loaded_entry.entry_id: {"allowed_locks": [1]}},
        }
    )
    before = manager.repository.snapshot()
    client = await hass_ws_client(hass)
    result = await scenario(client, person.id, loaded_entry.entry_id)
    assert result["success"], result
    assert (
        result["result"]["desired"]["allowed"]
        and result["result"]["physical_result"] == "not_verified"
    )
    assert "827461" not in json.dumps(result) and manager.repository.snapshot() == before
    invalid = await scenario(client, person.id, loaded_entry.entry_id, "2026-09-29T12:00:00")
    assert not invalid["success"] and invalid["error"]["code"] == "scenario_invalid_time"
    device_io["unlock"].assert_not_called()


async def test_scenario_viewer_scope_and_hidden_access(
    hass, loaded_entry, hass_ws_client, hass_read_only_user, hass_read_only_access_token, device_io
):
    manager = get_manager(hass)
    manager.register("outside", "Outside", True)
    p = await manager.repository.async_create(
        {"display_name": "Visible", "assignments": {loaded_entry.entry_id: {"allowed_locks": [1]}}}
    )
    outside = await manager.repository.async_create(
        {"display_name": "Hidden", "assignments": {"outside": {"allowed_locks": [1]}}}
    )
    permissions = hass.data[DOMAIN]["panel_permissions"]
    policy = {
        "enabled": True,
        "areas": {a: "view" if a == "users" else "none" for a in AREAS},
        "station_ids": [loaded_entry.entry_id],
        "fields": {k: "view" for k in FIELDS},
    }
    await permissions.update(
        permissions.revision, {hass_read_only_user.id: policy}, [hass_read_only_user.id]
    )
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    assert (await scenario(reader, p.id, loaded_entry.entry_id))["success"]
    assert not (await scenario(reader, p.id, "outside"))["success"]
    assert not (await scenario(reader, outside.id, loaded_entry.entry_id))["success"]
    policy["fields"]["access"] = "none"
    await permissions.update(
        permissions.revision, {hass_read_only_user.id: policy}, [hass_read_only_user.id]
    )
    hidden = await scenario(reader, p.id, loaded_entry.entry_id)
    assert not hidden["success"] and hidden["error"]["code"] == "field_access_denied"
    device_io["unlock"].assert_not_called()
