"""Authenticated periodic reviews preserve rights and enforce door/field scope."""

import json

from custom_components.hikvision_intercom.access_runtime import get_manager
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.panel_permissions import AREAS, FIELDS

from .test_websocket import request


async def report(client, sid):
    return await request(
        client,
        "users/access_reviews",
        user_id="",
        station_id=sid,
        lock_id=1,
        state="all",
        offset=0,
        limit=25,
        snapshot="",
    )


async def preview(client, uid, sid):
    return await request(
        client, "users/access_review_preview", user_id=uid, station_id=sid, lock_id=1
    )


async def decide(client, p, **patch):
    values = {
        key: p[key]
        for key in (
            "user_id",
            "station_id",
            "lock_id",
            "person_revision",
            "fingerprint",
            "latest_id",
        )
    }
    values.update(
        decision="keep", reason="Current policy reviewed", cadence_days=30, confirmed=True
    )
    values.update(patch)
    return await request(client, "users/access_review_decide", **values)


async def test_admin_receipt_actor_is_transport_identity_and_access_never_changes(
    hass, loaded_entry, hass_ws_client, hass_admin_user, device_io
):
    manager = get_manager(hass)
    person = await manager.repository.async_create(
        {
            "display_name": "Reviewed",
            "pin": "827461",
            "assignments": {loaded_entry.entry_id: {"allowed_locks": [1, 2]}},
        }
    )
    before = manager.repository.snapshot()
    client = await hass_ws_client(hass)
    p = await preview(client, person.id, loaded_entry.entry_id)
    assert p["success"], p
    result = await decide(client, p["result"])
    assert result["success"], result
    assert result["result"]["receipt"]["actor"] == hass_admin_user.id
    assert result["result"]["access_changed"] is False
    stale = await decide(client, p["result"])
    assert not stale["success"] and stale["error"]["code"] == "access_review_stale"
    rows = await report(client, loaded_entry.entry_id)
    assert rows["success"] and rows["result"]["records"][0]["status"] == "completed"
    assert "827461" not in json.dumps(rows)
    assert manager.repository.snapshot() == before
    device_io["unlock"].assert_not_called()


async def test_scoped_reviewer_may_review_shared_identity_without_changing_other_doors(
    hass, loaded_entry, hass_ws_client, hass_read_only_user, hass_read_only_access_token, device_io
):
    manager = get_manager(hass)
    manager.register("outside", "Outside", True)
    shared = await manager.repository.async_create(
        {
            "display_name": "Shared",
            "assignments": {
                loaded_entry.entry_id: {"allowed_locks": [1]},
                "outside": {"allowed_locks": [2]},
            },
        }
    )
    await manager.repository.async_create(
        {"display_name": "Hidden", "assignments": {"outside": {"allowed_locks": [1]}}}
    )
    before = manager.repository.snapshot()
    permissions = hass.data[DOMAIN]["panel_permissions"]
    policy = {
        "enabled": True,
        "areas": {a: "manage" if a == "users" else "none" for a in AREAS},
        "station_ids": [loaded_entry.entry_id],
        "fields": {k: "manage" if k == "access" else "view" for k in FIELDS},
    }
    await permissions.update(
        permissions.revision, {hass_read_only_user.id: policy}, [hass_read_only_user.id]
    )
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    rows = await report(reader, loaded_entry.entry_id)
    assert rows["success"] and rows["result"]["total"] == 1 and "Hidden" not in json.dumps(rows)
    p = await preview(reader, shared.id, loaded_entry.entry_id)
    assert p["success"], p
    r = await decide(reader, p["result"])
    assert r["success"] and r["result"]["receipt"]["actor"] == hass_read_only_user.id, r
    outside = await report(reader, "outside")
    assert not outside["success"]
    policy["fields"]["access"] = "view"
    await permissions.update(
        permissions.revision, {hass_read_only_user.id: policy}, [hass_read_only_user.id]
    )
    p = await preview(reader, shared.id, loaded_entry.entry_id)
    assert p["success"], p
    denied = await decide(reader, p["result"])
    assert not denied["success"]
    policy["fields"]["access"] = "none"
    await permissions.update(
        permissions.revision, {hass_read_only_user.id: policy}, [hass_read_only_user.id]
    )
    hidden = await report(reader, loaded_entry.entry_id)
    assert not hidden["success"]
    assert manager.repository.snapshot() == before
    device_io["unlock"].assert_not_called()
