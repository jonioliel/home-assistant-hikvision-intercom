"""Authenticated comparisons apply projection before sources, operands and counters."""

import json

from custom_components.hikvision_intercom.access_runtime import get_manager
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.panel_permissions import AREAS, FIELDS

from .test_websocket import request


async def configure_groups(client, sid):
    settings = (await request(client, "profiles/settings_get"))["result"]
    values = {k: v for k, v in settings.items() if k != "revision"}
    values["groups"] = [
        {
            "id": "management",
            "label": "Management",
            "enabled": True,
            "station_ids": [sid, "outside"],
        },
        {"id": "staff", "label": "Staff", "enabled": True, "station_ids": [sid]},
    ]
    result = await request(
        client, "profiles/settings_update", revision=settings["revision"], values=values
    )
    assert result["success"], result


async def test_admin_comparison_has_no_credentials_and_no_mutation(
    hass, loaded_entry, hass_ws_client, device_io
):
    manager = get_manager(hass)
    manager.register("outside", "Outside", True)
    client = await hass_ws_client(hass)
    await configure_groups(client, loaded_entry.entry_id)
    p = await manager.repository.async_create(
        {
            "display_name": "Compared",
            "pin": "827461",
            "group_ids": ["management"],
            "permission_overrides": {"outside": "deny"},
            "door_permissions": {loaded_entry.entry_id: [1, 2]},
        }
    )
    before = manager.repository.snapshot()
    result = await request(
        client,
        "users/access_compare",
        left_kind="person",
        left_id=p.id,
        right_kind="group",
        right_id="management",
    )
    assert result["success"], result
    assert (
        result["result"]["summary"]["left_only"] == 1
        and result["result"]["summary"]["right_only"] == 1
    )
    assert result["result"]["read_only"] and "827461" not in json.dumps(result)
    assert manager.repository.snapshot() == before
    device_io["unlock"].assert_not_called()


async def test_scoped_viewer_sees_only_visible_groups_and_no_hidden_source(
    hass, loaded_entry, hass_ws_client, hass_read_only_user, hass_read_only_access_token, device_io
):
    manager = get_manager(hass)
    manager.register("outside", "Outside", True)
    admin = await hass_ws_client(hass)
    await configure_groups(admin, loaded_entry.entry_id)
    p = await manager.repository.async_create(
        {"display_name": "Shared", "group_ids": ["management"]}
    )
    await manager.repository.async_create(
        {"display_name": "Private name", "assignments": {"outside": {"allowed_locks": [1]}}}
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
    choices = await request(
        reader, "users/access_compare_options", kind="group", query="", offset=0, limit=25
    )
    assert choices["success"] and choices["result"]["total"] == 1
    assert choices["result"]["records"][0]["id"] == "staff"
    result = await request(
        reader,
        "users/access_compare",
        left_kind="person",
        left_id=p.id,
        right_kind="group",
        right_id="staff",
    )
    assert result["success"], result
    assert result["result"]["rows"][0]["left"]["sources_known"] is False
    assert (
        "management" not in json.dumps(result)
        and "outside" not in json.dumps(result)
        and "Private name" not in json.dumps(result)
    )
    denied = await request(
        reader,
        "users/access_compare",
        left_kind="group",
        left_id="management",
        right_kind="group",
        right_id="staff",
    )
    assert not denied["success"]
    policy["fields"]["access"] = "none"
    await permissions.update(
        permissions.revision, {hass_read_only_user.id: policy}, [hass_read_only_user.id]
    )
    hidden = await request(
        reader, "users/access_compare_options", kind="person", query="", offset=0, limit=25
    )
    assert not hidden["success"]
    device_io["unlock"].assert_not_called()
