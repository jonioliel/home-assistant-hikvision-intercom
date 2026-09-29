"""The real transport scans projected scope before indexes and does not mutate access."""

import json

from custom_components.hikvision_intercom.access_runtime import get_manager
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.panel_permissions import AREAS, FIELDS

from .test_websocket import request


async def quality(client, **patch):
    return await request(
        client,
        "users/data_quality",
        kind="all",
        state="all",
        offset=0,
        limit=50,
        snapshot="",
        **patch,
    )


async def test_admin_quality_is_read_only_and_paged_from_current_metadata(
    hass, loaded_entry, hass_ws_client, device_io
):
    manager = get_manager(hass)
    one = await manager.repository.async_create(
        {"display_name": "Shared", "phone": "0501234567", "pin": "646464"}
    )
    await manager.repository.async_create({"display_name": "Shared", "phone": "0501234567"})
    before = manager.repository.snapshot()
    client = await hass_ws_client(hass)
    result = await quality(client)
    assert result["success"], result
    assert result["result"]["summary"]["duplicate"] == 4
    assert result["result"]["coverage"]["scanned"] == 2
    assert "646464" not in json.dumps(result) and result["result"]["read_only"]
    assert manager.repository.snapshot() == before
    await manager.repository.async_update(
        one.id, {"display_name": "Changed"}, expected_revision=one.revision
    )
    page = await request(
        client,
        "users/data_quality",
        kind="all",
        state="all",
        offset=1,
        limit=1,
        snapshot=result["result"]["snapshot"],
    )
    assert page["success"] and page["result"]["stale"] and not page["result"]["records"]
    device_io["unlock"].assert_not_called()


async def test_viewer_hidden_fields_and_outside_people_do_not_enter_quality(
    hass, loaded_entry, hass_ws_client, hass_read_only_user, hass_read_only_access_token, device_io
):
    admin = await hass_ws_client(hass)
    settings = (await request(admin, "profiles/settings_get"))["result"]
    values = {key: value for key, value in settings.items() if key != "revision"}
    values["fields"] = [
        {"id": "role", "label": "Role", "enabled": True, "options": []},
        {
            "id": "badge",
            "label": "Badge",
            "enabled": True,
            "options": [],
            "required": True,
            "depends_on": {"field_id": "role", "value": "staff"},
        },
    ]
    configured = await request(
        admin, "profiles/settings_update", revision=settings["revision"], values=values
    )
    assert configured["success"], configured
    manager = get_manager(hass)
    manager.register("outside", "Outside", True)
    for sid in [loaded_entry.entry_id, "outside"]:
        await manager.repository.async_create(
            {
                "display_name": "Private same name",
                "phone": "0501234567",
                "profile": {"role": "visitor", "badge": "PRIVATE-BADGE"},
                "assignments": {sid: {"allowed_locks": [1]}},
            }
        )
    permissions = hass.data[DOMAIN]["panel_permissions"]
    policy = {
        "enabled": True,
        "areas": {area: "view" if area == "users" else "none" for area in AREAS},
        "station_ids": [loaded_entry.entry_id],
        "fields": {key: "none" if key == "phone" else "view" for key in FIELDS},
        "profile_fields": {"role": "none"},
    }
    await permissions.update(
        permissions.revision, {hass_read_only_user.id: policy}, [hass_read_only_user.id]
    )
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    result = await quality(reader)
    assert result["success"], result
    assert result["result"]["coverage"]["scanned"] == 1
    assert result["result"]["coverage"]["unknown_fields"] == 1
    assert result["result"]["summary"]["people"] == 0
    assert "PRIVATE-BADGE" not in json.dumps(result) and "050-123-4567" not in json.dumps(result)
    policy["enabled"] = False
    await permissions.update(
        permissions.revision, {hass_read_only_user.id: policy}, [hass_read_only_user.id]
    )
    denied = await quality(reader)
    assert not denied["success"] and denied["error"]["code"] == "unauthorized"
    device_io["unlock"].assert_not_called()
