"""Real HA group-policy API authorization, persistence and effective synchronization."""

from unittest.mock import Mock

from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.const import DOMAIN

from .test_websocket import request


async def test_group_policy_and_user_overrides_share_atomic_ha_storage(
    hass, loaded_entry, hass_ws_client
):
    client = await hass_ws_client(hass)
    station = loaded_entry.entry_id
    values = {
        "fields": [],
        "photo_enabled": False,
        "groups": [
            {"id": "management", "label": "Management", "enabled": True, "station_ids": [station]}
        ],
    }
    assert (await request(client, "profiles/settings_update", revision=0, values=values))["success"]
    created = await request(
        client,
        "users/create",
        data={
            "display_name": "Demo",
            "group_ids": ["management"],
            "permission_overrides": {},
            "access_policy_revision": 1,
        },
        sync_now=False,
    )
    assert created["success"] and created["result"]["assignments"][station]["enabled"]
    uid = created["result"]["id"]
    manager = hass.data[DOMAIN]["access"]
    original = manager.request_user
    manager.request_user = Mock()
    try:
        denied = await request(
            client,
            "users/update",
            user_id=uid,
            revision=1,
            data={"permission_overrides": {station: "deny"}, "access_policy_revision": 1},
            sync_now=False,
        )
        assert denied["success"] and not denied["result"]["assignments"][station]["enabled"]
        reset = await request(
            client,
            "users/update",
            user_id=uid,
            revision=2,
            data={"permission_overrides": {}, "access_policy_revision": 1},
            sync_now=False,
        )
        assert reset["success"] and reset["result"]["assignments"][station]["enabled"]
        values["groups"][0]["enabled"] = False
        assert (await request(client, "profiles/settings_update", revision=1, values=values))[
            "success"
        ]
        manager.request_user.assert_called_once_with(uid)
        state = manager.repository.snapshot()
        assert state["profile_settings"]["revision"] == 2
        assert not any(a["enabled"] for a in state["users"][uid]["assignments"].values())
        from unittest.mock import AsyncMock

        restored = AccessRepository(AsyncMock())
        await restored.async_load(state)
        assert restored.get(uid).group_ids == ["management"]
    finally:
        manager.request_user = original


async def test_group_settings_reject_unknown_station_reader_and_stale_revision(
    hass, loaded_entry, hass_ws_client, hass_read_only_access_token
):
    admin = await hass_ws_client(hass)
    values = {
        "fields": [],
        "photo_enabled": False,
        "groups": [{"id": "g", "label": "Group", "enabled": True, "station_ids": ["missing"]}],
    }
    result = await request(admin, "profiles/settings_update", revision=0, values=values)
    assert not result["success"] and result["error"]["code"] == "station_not_found"
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    values["groups"][0]["station_ids"] = [loaded_entry.entry_id]
    assert not (await request(reader, "profiles/settings_update", revision=0, values=values))[
        "success"
    ]
    assert (await request(admin, "profiles/settings_update", revision=0, values=values))["success"]
    stale = await request(
        admin,
        "users/create",
        data={
            "display_name": "Demo",
            "group_ids": ["g"],
            "permission_overrides": {},
            "access_policy_revision": 0,
        },
        sync_now=False,
    )
    assert not stale["success"] and stale["error"]["code"] == "group_policy_changed"


async def test_prior_profile_file_is_seeded_once_into_authoritative_access_store(hass, device_io):
    from pytest_homeassistant_custom_component.common import MockConfigEntry

    from custom_components.hikvision_intercom.storage import AccessStore

    from .conftest import DATA, PROFILE

    legacy = AccessStore(hass, key=f"{DOMAIN}.profile_settings")
    await legacy.async_save(
        {
            "schema": 1,
            "revision": 4,
            "values": {
                "fields": [],
                "groups": [{"id": "staff", "label": "Staff", "enabled": True}],
                "photo_enabled": True,
            },
        }
    )
    entry = MockConfigEntry(domain=DOMAIN, title="Front", unique_id=PROFILE.unique_id, data=DATA)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    try:
        profiles = hass.data[DOMAIN]["profile_settings"]
        assert profiles.public()["revision"] == 4 and profiles.public()["photo_enabled"]
        values = {
            "fields": [],
            "groups": [{"id": "staff", "label": "New name", "enabled": True}],
            "photo_enabled": False,
        }
        await profiles.update(4, values)
        stored = await AccessStore(hass).async_load()
        assert stored["profile_settings"]["revision"] == 5
        assert stored["profile_settings"]["values"]["groups"][0]["label"] == "New name"
        # Old file is intentionally untouched; it cannot replace a committed central policy.
        assert (await legacy.async_load())["revision"] == 4
    finally:
        await hass.config_entries.async_unload(entry.entry_id)
