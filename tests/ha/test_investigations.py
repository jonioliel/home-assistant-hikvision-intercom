"""Cross-source investigations remain administrator-only on the actual HA transport."""

import json
from datetime import UTC, datetime
from unittest.mock import patch

from custom_components.hikvision_intercom.access_runtime import get_manager
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.events import normalize_event

from .test_websocket import request


async def investigate(client, **values):
    return await request(
        client, "investigations/query", filters={}, offset=0, limit=100, snapshot="", **values
    )


async def test_investigation_is_safe_readonly_and_reports_missing_events(
    hass, loaded_entry, hass_ws_client, device_io
):
    client = await hass_ws_client(hass)
    created = await request(
        client,
        "users/create",
        data={"display_name": "Investigated", "pin": "972841"},
        sync_now=False,
    )
    assert created["success"]
    manager = get_manager(hass)
    now = datetime.now(UTC)
    event = normalize_event(
        {"major": 5, "minor": 1, "time": now.isoformat(), "cardNo": "83649125"},
        loaded_entry.entry_id,
        b"x" * 32,
        received=now,
        selected_api=1,
        historical=True,
    )
    hass.data[DOMAIN]["events"].accept(event)
    before = manager.repository.snapshot()
    with patch.object(manager, "request_user") as queued:
        result = await investigate(client, api_contract=999)
        assert result["success"], result
        assert {row["source"] for row in result["result"]["records"]} >= {"access", "change"}
        assert result["result"]["sources"]["access_available"]
        assert "972841" not in json.dumps(result) and "83649125" not in json.dumps(result)
        queued.assert_not_called()
    assert manager.repository.snapshot() == before
    device_io["unlock"].assert_not_awaited()
    events = hass.data[DOMAIN].pop("events")
    try:
        missing = await investigate(client)
        assert missing["success"] and not missing["result"]["sources"]["access_available"]
    finally:
        hass.data[DOMAIN]["events"] = events


async def test_delegated_all_area_manager_cannot_read_administrative_timeline(
    hass, loaded_entry, hass_ws_client, hass_read_only_access_token, hass_read_only_user
):
    admin = await hass_ws_client(hass)
    saved = await request(
        admin,
        "authorization/settings_update",
        revision=0,
        users={
            hass_read_only_user.id: {
                "enabled": True,
                "areas": {
                    area: "manage"
                    for area in ("overview", "users", "events", "stations", "management")
                },
            }
        },
    )
    assert saved["success"]
    viewer = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    denied = await investigate(viewer)
    assert not denied["success"] and denied["error"]["code"] == "unauthorized"
