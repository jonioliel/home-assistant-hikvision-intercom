"""Real fleet-alert transport with server authorization and no device mutation."""

from unittest.mock import patch

from custom_components.hikvision_intercom.access_runtime import get_manager
from custom_components.hikvision_intercom.const import DOMAIN

from .test_websocket import request


async def query(client):
    return await request(
        client, "fleet/alerts", offset=0, limit=100, station_id="", kind="", include_suppressed=True
    )


async def suppress(client, station_id, revision=0):
    return await request(
        client,
        "fleet/alerts_action",
        revision=revision,
        station_id=station_id,
        kind="maintenance",
        action="suppress",
        duration_minutes=60,
        reason="planned_maintenance",
    )


async def test_fleet_alerts_are_observational_and_maintenance_is_durable(
    hass,
    loaded_entry,
    hass_ws_client,
    device_io,
):
    client = await hass_ws_client(hass)
    manager = get_manager(hass)
    before = manager.repository.snapshot()
    with patch.object(manager, "request_user") as queued:
        viewed = await query(client)
        assert viewed["success"] and viewed["result"]["revision"] == 0, viewed
        saved = await suppress(client, loaded_entry.entry_id)
        assert saved["success"] and saved["result"]["revision"] == 1, saved
        report = await query(client)
        assert (
            report["success"]
            and report["result"]["suppressions"][0]["station_id"] == loaded_entry.entry_id
        )
        assert report["result"]["suppressions"][0]["actor"]
        queued.assert_not_called()
        assert manager.repository.snapshot() == before
    device_io["unlock"].assert_not_awaited()
    assert "demo-secret" not in str(report)
    stale = await suppress(client, loaded_entry.entry_id)
    assert not stale["success"] and stale["error"]["code"] == "revision_conflict"
    missing = await suppress(client, "missing", revision=1)
    assert not missing["success"] and missing["error"]["code"] == "station_not_found"
    hass.data[DOMAIN]["fleet_alerts"] = None
    unavailable = await query(client)
    assert not unavailable["success"] and unavailable["error"]["code"] == "fleet_alerts_unavailable"


async def test_station_viewer_reads_but_cannot_change_suppression(
    hass,
    loaded_entry,
    hass_ws_client,
    hass_read_only_access_token,
    hass_read_only_user,
):
    admin = await hass_ws_client(hass)
    areas = {area: "none" for area in ("overview", "users", "events", "stations", "management")}
    assert (
        await request(
            admin,
            "authorization/settings_update",
            revision=0,
            users={
                hass_read_only_user.id: {"enabled": True, "areas": {**areas, "stations": "view"}}
            },
        )
    )["success"]
    viewer = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    assert (await query(viewer))["success"]
    denied = await suppress(viewer, loaded_entry.entry_id)
    assert not denied["success"] and denied["error"]["code"] == "unauthorized"
    assert (
        await request(
            admin,
            "authorization/settings_update",
            revision=1,
            users={
                hass_read_only_user.id: {"enabled": True, "areas": {**areas, "stations": "manage"}}
            },
        )
    )["success"]
    assert (await suppress(viewer, loaded_entry.entry_id))["success"]
    assert (await request(admin, "authorization/settings_update", revision=2, users={}))["success"]
    denied = await query(viewer)
    assert not denied["success"] and denied["error"]["code"] == "unauthorized"
