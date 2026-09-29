import json

from custom_components.hikvision_intercom.access_runtime import get_manager
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.panel_permissions import AREAS, FIELDS

from .test_websocket import request


async def test_bulk_renewal_review_and_dual_approval_boundary(
    hass, loaded_entry, hass_ws_client, device_io
):
    client = await hass_ws_client(hass)
    manager = get_manager(hass)
    person = await manager.repository.async_create(
        {
            "display_name": "Temporary",
            "pin": "825731",
            "valid_from": "2026-01-01T00:00:00Z",
            "valid_until": "2035-01-01T00:00:00Z",
        }
    )
    before = manager.repository.snapshot()
    result = await request(
        client,
        "users/bulk_renewal_preview",
        selection=[{"user_id": person.id, "revision": person.revision}],
        until="2036-01-01T00:00:00Z",
    )
    assert result["success"], result
    assert manager.repository.snapshot() == before
    assert "825731" not in json.dumps(result)
    center = hass.data[DOMAIN]["workflows"]
    await center.update_settings(
        0, {"idle_minutes": 0, "reauth_sensitive": False, "dual_approval": True}
    )
    denied = await request(
        client, "users/bulk_apply", operation_id=result["result"]["operation_id"]
    )
    assert denied["error"]["code"] == "approval_required"
    assert manager.repository.get(person.id).valid_until == person.valid_until
    device_io["unlock"].assert_not_called()


async def test_full_delegated_operator_cannot_bulk_renew(
    hass, loaded_entry, hass_ws_client, hass_read_only_user, hass_read_only_access_token
):
    permissions = hass.data[DOMAIN]["panel_permissions"]
    await permissions.update(
        permissions.revision,
        {
            hass_read_only_user.id: {
                "enabled": True,
                "areas": {a: "manage" for a in AREAS},
                "fields": {f: "manage" for f in FIELDS},
                "station_ids": None,
            }
        },
        [hass_read_only_user.id],
    )
    client = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    denied = await request(
        client, "users/bulk_renewal_preview", selection=[], until="2036-01-01T00:00:00Z"
    )
    assert denied["error"]["code"] == "unauthorized"
