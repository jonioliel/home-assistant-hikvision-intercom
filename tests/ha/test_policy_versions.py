import json

from custom_components.hikvision_intercom.access_runtime import get_manager
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.panel_permissions import AREAS, FIELDS

from .test_websocket import request


async def test_admin_reads_before_after_and_unchanged_access(
    hass, loaded_entry, hass_ws_client, device_io
):
    client = await hass_ws_client(hass)
    manager = get_manager(hass)
    settings = (await request(client, "profiles/settings_get"))["result"]
    values = {k: v for k, v in settings.items() if k != "revision"}
    values["groups"] = [
        {"id": "staff", "label": "Staff", "enabled": True, "station_ids": [loaded_entry.entry_id]}
    ]
    result = await request(
        client, "profiles/settings_update", revision=settings["revision"], values=values
    )
    assert result["success"], result
    before_revision = result["result"]["revision"]
    person = await manager.repository.async_create(
        {"display_name": "Private", "pin": "827461", "group_ids": ["staff"]}
    )
    values["groups"][0]["label"] = "Operators"
    result = await request(
        client, "profiles/settings_update", revision=before_revision, values=values
    )
    assert result["success"], result
    before = manager.repository.snapshot()
    after_revision = result["result"]["revision"]
    versions = await request(client, "profiles/versions", offset=0, limit=10)
    assert versions["success"], versions
    comparison = await request(
        client,
        "profiles/versions_compare",
        before_revision=before_revision,
        after_revision=after_revision,
    )
    assert comparison["success"], comparison
    assert comparison["result"]["summary"]["groups"] == 1 and comparison["result"]["read_only"]
    assert "827461" not in json.dumps(versions) + json.dumps(comparison)
    assert (
        before == manager.repository.snapshot()
        and manager.repository.get(person.id).revision == person.revision
    )
    device_io["unlock"].assert_not_called()


async def test_delegated_management_cannot_read_historical_scopes(
    hass, loaded_entry, hass_ws_client, hass_read_only_user, hass_read_only_access_token
):
    permissions = hass.data[DOMAIN]["panel_permissions"]
    policy = {
        "enabled": True,
        "areas": {a: "manage" for a in AREAS},
        "fields": {f: "manage" for f in FIELDS},
        "station_ids": None,
    }
    await permissions.update(
        permissions.revision, {hass_read_only_user.id: policy}, [hass_read_only_user.id]
    )
    client = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    for command, fields in [
        ("profiles/versions", {"offset": 0, "limit": 10}),
        ("profiles/versions_compare", {"before_revision": 0, "after_revision": 1}),
    ]:
        result = await request(client, command, **fields)
        assert not result["success"]
