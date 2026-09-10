"""Actual HA admin identity, private persistence, batch replay and safe projections."""

import json
from unittest.mock import AsyncMock, patch

from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.access_runtime import get_manager
from custom_components.hikvision_intercom.storage import AccessStore

from .test_websocket import request


async def test_bulk_receipt_and_audit_survive_real_ha_store(
    hass, loaded_entry, hass_ws_client, device_io
):
    client = await hass_ws_client(hass)
    created = await request(
        client,
        "users/create",
        data={"display_name": "Bulk Resident", "pin": "648219", "cards": [{"card_no": "33997124"}]},
        sync_now=False,
    )
    assert created["success"]
    user = created["result"]
    reviewed = await request(
        client,
        "users/bulk_preview",
        request={
            "action": "remove_pin",
            "selection": [{"user_id": user["id"], "revision": user["revision"]}],
        },
    )
    assert reviewed["success"]
    oid = reviewed["result"]["operation_id"]
    saved = await request(client, "users/bulk_apply", operation_id=oid)
    assert saved["success"] and saved["result"]["changed"] == 1
    actor = saved["result"]["actor"]
    assert actor and await hass.auth.async_get_user(actor)
    audit = await request(client, "audit/list", filters={"user_id": user["id"]})
    assert audit["success"] and audit["result"]["records"][0]["action"] == "bulk/remove_pin"
    assert audit["result"]["records"][0]["actor"] == actor
    assert audit["result"]["records"][0]["before"]["pin_configured"]
    assert not audit["result"]["records"][0]["after"]["pin_configured"]
    for command in ("audit/export", "users/bulk_receipts"):
        reply = await request(
            client, command, **({"filters": {}} if command == "audit/export" else {})
        )
        assert reply["success"]
        assert "648219" not in json.dumps(reply) and "33997124" not in json.dumps(reply)
    store = AccessStore(hass)
    restored = AccessRepository(store.async_save)
    await restored.async_load(await store.async_load())
    assert oid in restored.snapshot()["operation_receipts"]
    assert restored.snapshot()["admin_audit"]["records"][-1]["actor"] == actor
    replay = await request(client, "users/bulk_apply", operation_id=oid)
    assert replay["result"] == saved["result"]
    assert get_manager(hass).repository.get(user["id"]).revision == 2
    device_io["unlock"].assert_not_called()


async def test_caller_cannot_supply_audit_actor_or_credential_in_batch(
    hass, loaded_entry, hass_ws_client
):
    client = await hass_ws_client(hass)
    reply = await request(
        client,
        "users/bulk_preview",
        request={"action": "delete", "selection": []},
        actor="impersonated",
    )
    assert not reply["success"] and "impersonated" not in json.dumps(reply)
    reply = await request(
        client,
        "users/bulk_preview",
        request={
            "action": "remove_pin",
            "selection": [{"user_id": "x", "revision": 1}],
            "pin": "SECRET_BATCH",
        },
    )
    assert not reply["success"] and "SECRET_BATCH" not in json.dumps(reply)


async def test_permission_audit_endpoint_is_readonly_and_bounded(
    hass, loaded_entry, hass_ws_client, device_io
):
    client = await hass_ws_client(hass)
    with patch(
        "custom_components.hikvision_intercom.admin_operations_api.inspect_permissions",
        AsyncMock(return_value={"device_writes": 0, "rows": []}),
    ) as read:
        result = await request(
            client, "stations/permission_audit", station_id=loaded_entry.entry_id
        )
        assert result["success"] and result["result"]["device_writes"] == 0
        read.assert_awaited_once()
    device_io["unlock"].assert_not_called()


async def test_group_policy_review_and_directory_use_real_admin_transport(
    hass, loaded_entry, hass_ws_client, device_io
):
    client = await hass_ws_client(hass)
    current = await request(client, "profiles/settings_get")
    values = {k: v for k, v in current["result"].items() if k != "revision"}
    values["groups"] = [
        {"id": "staff", "label": "Staff", "enabled": True, "station_ids": [loaded_entry.entry_id]}
    ]
    preview = await request(
        client, "profiles/settings_preview", revision=current["result"]["revision"], values=values
    )
    assert preview["success"] and preview["result"]["device_writes"] == 0
    saved = await request(
        client, "profiles/settings_apply", operation_id=preview["result"]["operation_id"]
    )
    assert saved["success"] and saved["result"]["action"] == "bulk/group_policy"
    assert (await request(client, "profiles/settings_get"))["result"]["groups"][0]["id"] == "staff"
    directory = await request(
        client, "permissions/directory", filters={"station_id": loaded_entry.entry_id}
    )
    assert directory["success"] and directory["result"]["total"] == 0
    bad = await request(client, "permissions/directory", filters={"station_id": []})
    assert not bad["success"] and bad["error"]["code"] == "invalid_text"
    device_io["unlock"].assert_not_called()
