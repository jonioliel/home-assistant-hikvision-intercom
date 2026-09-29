"""Archive actions through the real authenticated runtime; hardware is mocked."""

from homeassistant.auth.const import GROUP_ID_ADMIN

from custom_components.hikvision_intercom.access_runtime import get_manager
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.panel_permissions import AREAS, FIELDS


async def request(client, route, **data):
    await client.send_json_auto_id({"type": f"{DOMAIN}/{route}", **data})
    return await client.receive_json()


async def test_confirmed_archive_and_restore_leave_identity_inactive(
    hass, loaded_entry, hass_ws_client
):
    manager = get_manager(hass)
    person = await manager.repository.async_create(
        {"display_name": "Archive identity", "pin": "849273"}
    )
    client = await hass_ws_client(hass)
    denied = await request(
        client, "users/archive", user_id=person.id, revision=person.revision, confirmed=False
    )
    assert denied["error"]["code"] == "confirmation_required"
    assert manager.repository.get(person.id).active
    response = await request(
        client, "users/archive", user_id=person.id, revision=person.revision, confirmed=True
    )
    assert response["success"], response
    archived = manager.repository.get(person.id)
    assert archived.archived_at and not archived.active
    response = await request(
        client, "users/update", user_id=person.id, revision=archived.revision, data={"active": True}
    )
    assert response["error"]["code"] == "user_archived"
    response = await request(
        client, "users/unarchive", user_id=person.id, revision=archived.revision, confirmed=True
    )
    assert response["success"], response
    restored = manager.repository.get(person.id)
    assert not restored.active and restored.archived_at is None
    assert restored.employee_no == person.employee_no and restored.pin.value == "849273"


async def test_archive_is_admin_only_even_with_people_management(
    hass, loaded_entry, hass_ws_client, hass_read_only_user, hass_read_only_access_token
):
    manager = get_manager(hass)
    person = await manager.repository.async_create({"display_name": "Protected identity"})
    permissions = hass.data[DOMAIN]["panel_permissions"]
    policy = {
        "enabled": True,
        "areas": dict.fromkeys(AREAS, "manage"),
        "station_ids": None,
        "fields": dict.fromkeys(FIELDS, "manage"),
    }
    await permissions.update(
        permissions.revision, {hass_read_only_user.id: policy}, [hass_read_only_user.id]
    )
    client = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    overview = await request(client, "overview")
    assert "users/archive" not in overview["result"]["api"]["commands"]
    denied = await request(
        client, "users/archive", user_id=person.id, revision=person.revision, confirmed=True
    )
    assert not denied["success"] and manager.repository.get(person.id).active


async def test_archive_dual_approval_checks_current_second_admin(
    hass, loaded_entry, hass_ws_client
):
    manager = get_manager(hass)
    person = await manager.repository.async_create({"display_name": "Reviewed archive"})
    center = hass.data[DOMAIN]["workflows"]
    await center.update_settings(
        0, {"idle_minutes": 0, "reauth_sensitive": False, "dual_approval": True}
    )
    client = await hass_ws_client(hass)
    values = {"user_id": person.id, "revision": person.revision, "confirmed": True}
    denied = await request(client, "users/archive", **values)
    assert denied["error"]["code"] == "approval_required"
    submitted = await request(
        client, "workflows/submit", command="users/archive", values=values, label="Archive"
    )
    assert submitted["success"], submitted
    identity = submitted["result"]["id"]
    denied = await request(client, "workflows/decide", request_id=identity, approve=True)
    assert denied["error"]["code"] == "separate_approver_required"
    reviewer = await hass.auth.async_create_user("Archive reviewer", group_ids=[GROUP_ID_ADMIN])
    await center.decide(reviewer.id, identity, True)
    reviewer.is_active = False
    denied = await request(client, "workflows/apply", request_id=identity)
    assert not denied["success"] and manager.repository.get(person.id).active
    reviewer.is_active = True
    applied = await request(client, "workflows/apply", request_id=identity)
    assert applied["success"], applied
    assert manager.repository.get(person.id).archived_at
