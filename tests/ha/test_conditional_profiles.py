"""Conditional policy and hidden ancestors are enforced at actual transport boundaries."""

from custom_components.hikvision_intercom.access_runtime import get_manager
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.panel_permissions import AREAS

from .test_websocket import request


async def configure(client):
    policy = (await request(client, "profiles/settings_get"))["result"]
    values = {key: value for key, value in policy.items() if key != "revision"}
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
    saved = await request(
        client, "profiles/settings_update", revision=policy["revision"], values=values
    )
    assert saved["success"], saved
    return saved["result"]


async def test_transport_requires_newly_active_child_and_preserves_old_client_rules(
    hass, loaded_entry, hass_ws_client, device_io
):
    client = await hass_ws_client(hass)
    settings = await configure(client)
    created = await request(
        client,
        "users/create",
        data={"display_name": "Guest", "profile": {"role": "visitor"}},
        sync_now=False,
    )
    assert created["success"], created
    user = created["result"]
    blocked = await request(
        client,
        "users/update",
        user_id=user["id"],
        data={"profile": {"role": "staff"}},
        revision=user["revision"],
        sync_now=False,
    )
    assert not blocked["success"] and blocked["error"]["code"] == "profile_required"
    assert get_manager(hass).repository.get(user["id"]).profile == {"role": "visitor"}
    allowed = await request(
        client,
        "users/update",
        user_id=user["id"],
        data={"profile": {"role": "staff", "badge": "2"}},
        revision=user["revision"],
        sync_now=False,
    )
    assert allowed["success"], allowed
    values = {key: value for key, value in settings.items() if key != "revision"}
    for field in values["fields"]:
        field.pop("depends_on")
    values["fields"][0]["label"] = "Category"
    renamed = await request(
        client, "profiles/settings_update", revision=settings["revision"], values=values
    )
    assert renamed["success"] and renamed["result"]["fields"][1]["depends_on"]["value"] == "staff"
    device_io["unlock"].assert_not_called()


async def test_hidden_parent_blocks_child_write_without_disclosing_predicate(
    hass, loaded_entry, hass_ws_client, hass_read_only_user, hass_read_only_access_token, device_io
):
    admin = await hass_ws_client(hass)
    await configure(admin)
    created = await request(
        admin,
        "users/create",
        data={"display_name": "Staff", "profile": {"role": "staff", "badge": "2"}},
        sync_now=False,
    )
    assert created["success"]
    permissions = hass.data[DOMAIN]["panel_permissions"]
    await permissions.update(
        permissions.revision,
        {
            hass_read_only_user.id: {
                "enabled": True,
                "areas": dict.fromkeys(AREAS, "manage"),
                "profile_fields": {"role": "none"},
            }
        },
        [hass_read_only_user.id],
    )
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    catalog = await request(reader, "profiles/settings_get")
    assert catalog["success"]
    fields = catalog["result"]["fields"]
    assert len(fields) == 1 and fields[0]["applicability_unknown"] and "depends_on" not in fields[0]
    user = created["result"]
    blocked = await request(
        reader,
        "users/update",
        user_id=user["id"],
        data={"profile": {"badge": "3"}},
        revision=user["revision"],
        sync_now=False,
    )
    assert not blocked["success"] and blocked["error"]["code"] == "field_access_denied"
    allowed = await request(
        reader,
        "users/update",
        user_id=user["id"],
        data={"display_name": "Renamed", "profile": {}},
        revision=user["revision"],
        sync_now=False,
    )
    assert allowed["success"], allowed
    assert allowed["result"]["profile"] == {"badge": "2"}
    assert get_manager(hass).repository.get(user["id"]).profile == {"role": "staff", "badge": "2"}
    device_io["unlock"].assert_not_called()
