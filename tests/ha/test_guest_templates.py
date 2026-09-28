"""Real authenticated preset API, including configured relays and delegated rights."""

from unittest.mock import patch

from custom_components.hikvision_intercom.access_runtime import get_manager
from custom_components.hikvision_intercom.const import DOMAIN

from .test_websocket import request


def values(station_id, **patch_values):
    return {
        "label": "Inspection",
        "access_category": "contractor",
        "responsible_person": "Host",
        "access_purpose": "Annual service",
        "duration_minutes": 120,
        "doors": {station_id: [1]},
        "weekly_timing": None,
        **patch_values,
    }


async def test_templates_validate_actual_relays_without_granting_or_syncing_users(
    hass, loaded_entry, hass_ws_client
):
    client = await hass_ws_client(hass)
    manager = get_manager(hass)
    before = manager.repository.snapshot()
    with patch.object(manager, "request_user") as queued:
        created = await request(
            client,
            "guest_templates/upsert",
            revision=0,
            template_id="",
            values=values(loaded_entry.entry_id),
        )
        assert created["success"], created
        assert created["result"]["revision"] == 1
        assert created["result"]["items"][0]["updated_by"]
        queued.assert_not_called()
        assert manager.repository.snapshot() == before
    invalid = await request(
        client,
        "guest_templates/upsert",
        revision=1,
        template_id="",
        values=values(loaded_entry.entry_id, doors={loaded_entry.entry_id: [2]}),
    )
    assert not invalid["success"] and invalid["error"]["code"] == "unmanaged_lock"
    missing = await request(
        client, "guest_templates/upsert", revision=1, template_id="", values=values("missing")
    )
    assert not missing["success"] and missing["error"]["code"] == "station_not_found"
    wire = await request(client, "guest_templates/get")
    assert wire["success"] and wire["result"] == created["result"]
    assert hass.data[DOMAIN]["guest_templates"].public() == created["result"]
    deleted = await request(
        client,
        "guest_templates/delete",
        revision=1,
        template_id=created["result"]["items"][0]["id"],
    )
    assert deleted["success"] and deleted["result"] == {"revision": 2, "items": []}


async def test_delegated_viewer_reads_presets_but_only_user_manager_can_change(
    hass, loaded_entry, hass_ws_client, hass_read_only_access_token, hass_read_only_user
):
    admin = await hass_ws_client(hass)
    areas = {area: "none" for area in ("overview", "users", "events", "stations", "management")}
    saved = await request(
        admin,
        "authorization/settings_update",
        revision=0,
        users={hass_read_only_user.id: {"enabled": True, "areas": {**areas, "users": "view"}}},
    )
    assert saved["success"]
    delegated = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    assert (await request(delegated, "guest_templates/get"))["success"]
    denied = await request(
        delegated,
        "guest_templates/upsert",
        revision=0,
        template_id="",
        values=values(loaded_entry.entry_id),
    )
    assert not denied["success"] and denied["error"]["code"] == "unauthorized"
    assert (
        await request(
            admin,
            "authorization/settings_update",
            revision=1,
            users={
                hass_read_only_user.id: {"enabled": True, "areas": {**areas, "users": "manage"}}
            },
        )
    )["success"]
    created = await request(
        delegated,
        "guest_templates/upsert",
        revision=0,
        template_id="",
        values=values(loaded_entry.entry_id),
    )
    assert (
        created["success"] and created["result"]["items"][0]["updated_by"] == hass_read_only_user.id
    )
    assert (await request(admin, "authorization/settings_update", revision=2, users={}))["success"]
    denied = await request(delegated, "guest_templates/get")
    assert not denied["success"] and denied["error"]["code"] == "unauthorized"
