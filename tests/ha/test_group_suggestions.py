"""Suggestions are scope-projected reads; save continues through existing workflows."""

import json

from custom_components.hikvision_intercom.access_runtime import get_manager
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.panel_permissions import AREAS, FIELDS

from .test_websocket import request


async def configure(client, sid):
    settings = (await request(client, "profiles/settings_get"))["result"]
    values = {k: v for k, v in settings.items() if k != "revision"}
    values["fields"] = [
        {"id": "department", "label": "Department", "enabled": True, "type": "text", "options": []},
        {
            "id": "role",
            "label": "Role",
            "enabled": True,
            "type": "text",
            "options": [],
            "depends_on": {"field_id": "department", "value": "Operations"},
        },
    ]
    values["groups"] = [
        {"id": "maintenance", "label": "Maintenance", "enabled": True, "station_ids": [sid]},
        {
            "id": "global",
            "label": "Hidden global group",
            "enabled": True,
            "station_ids": [sid, "outside"],
        },
    ]
    result = await request(
        client, "profiles/settings_update", revision=settings["revision"], values=values
    )
    assert result["success"], result
    return result["result"]


async def test_admin_suggestions_are_read_only_preserve_blocks_and_credentials(
    hass, loaded_entry, hass_ws_client, device_io
):
    manager = get_manager(hass)
    manager.register("outside", "Outside", True)
    client = await hass_ws_client(hass)
    await configure(client, loaded_entry.entry_id)
    target = await manager.repository.async_create(
        {
            "display_name": "Target",
            "pin": "827461",
            "profile": {"department": "Operations", "role": "Cleaner"},
            "permission_overrides": {loaded_entry.entry_id: "deny"},
        }
    )
    await manager.repository.async_create(
        {
            "display_name": "Donor",
            "profile": {"department": "Operations", "role": "Cleaner"},
            "group_ids": ["maintenance"],
        }
    )
    before = manager.repository.snapshot()
    result = await request(
        client, "users/group_suggestions", user_id=target.id, field_ids=["department", "role"]
    )
    assert result["success"], result
    assert result["result"]["suggestions"][0]["doors"][0]["blocked"]
    assert result["result"]["suggestions"][0]["doors"][0]["after"] == []
    assert result["result"]["person_revision"] == target.revision
    assert "827461" not in json.dumps(result) and "Donor" not in json.dumps(result)
    assert before == manager.repository.snapshot()
    device_io["unlock"].assert_not_called()


async def test_hidden_ancestor_and_global_memberships_are_not_suggestion_evidence(
    hass, loaded_entry, hass_ws_client, hass_read_only_user, hass_read_only_access_token, device_io
):
    manager = get_manager(hass)
    manager.register("outside", "Outside", True)
    admin = await hass_ws_client(hass)
    await configure(admin, loaded_entry.entry_id)
    target = await manager.repository.async_create(
        {
            "display_name": "Target",
            "profile": {"department": "Operations", "role": "Cleaner"},
            "assignments": {loaded_entry.entry_id: {"allowed_locks": [1]}},
        }
    )
    await manager.repository.async_create(
        {
            "display_name": "Donor",
            "profile": {"department": "Operations", "role": "Cleaner"},
            "group_ids": ["global"],
        }
    )
    permissions = hass.data[DOMAIN]["panel_permissions"]
    policy = {
        "enabled": True,
        "areas": {a: "view" if a == "users" else "none" for a in AREAS},
        "station_ids": [loaded_entry.entry_id],
        "fields": {f: "view" for f in FIELDS},
        "profile_fields": {"department": "none", "role": "view"},
    }
    await permissions.update(
        permissions.revision, {hass_read_only_user.id: policy}, [hass_read_only_user.id]
    )
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    result = await request(reader, "users/group_suggestions", user_id=target.id, field_ids=[])
    assert result["success"], result
    assert result["result"]["fields"] == [] and result["result"]["suggestions"] == []
    assert "Hidden global group" not in json.dumps(result) and "Operations" not in json.dumps(
        result
    )
    denied = await request(reader, "users/group_suggestions", user_id=target.id, field_ids=["role"])
    assert not denied["success"]
    policy["fields"]["profile"] = "none"
    await permissions.update(
        permissions.revision, {hass_read_only_user.id: policy}, [hass_read_only_user.id]
    )
    denied = await request(reader, "users/group_suggestions", user_id=target.id, field_ids=[])
    assert not denied["success"]
    device_io["unlock"].assert_not_called()
