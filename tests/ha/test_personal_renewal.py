"""Verify personal identity boundaries using real authenticated HA WebSockets."""

import json

from custom_components.hikvision_intercom.access_runtime import get_manager
from custom_components.hikvision_intercom.const import DOMAIN


async def request(client, command, **data):
    await client.send_json_auto_id({"type": f"{DOMAIN}/{command}", "api_contract": 1, **data})
    return await client.receive_json()


async def setup_person(
    hass, loaded_entry, hass_ws_client, hass_read_only_access_token, hass_read_only_user
):
    admin = await hass_ws_client(hass)
    personal = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    manager = get_manager(hass)
    created = await manager.async_create(
        {
            "display_name": "Personal record",
            "pin": "918472",
            "cards": [{"card_no": "718463"}],
            "valid_from": "2030-01-01T00:00:00Z",
            "valid_until": "2035-01-01T00:00:00Z",
        }
    )
    person = manager.repository.get(created["id"])
    linked = await request(
        admin,
        "renewal/binding_update",
        account_id=hass_read_only_user.id,
        user_id=person.id,
        revision=0,
        confirmed=True,
    )
    assert linked["success"], linked
    return admin, personal, person


async def test_unlinked_personal_account_gets_only_safe_own_state(
    hass, loaded_entry, hass_ws_client, hass_read_only_access_token
):
    personal = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    result = await request(personal, "renewal/self")
    assert result["success"] and result["result"] == {
        "linked": False,
        "timezone": hass.config.time_zone,
        "api_contract": 1,
    }
    session = await request(personal, "authorization/session")
    assert session["result"]["personal_renewal"] and not session["result"]["allowed"]
    assert (await request(personal, "security/session"))["success"]
    for command in (
        "renewal/bindings",
        "renewal/binding_update",
        "overview",
        "users/list",
        "workflows/get",
    ):
        result = await request(personal, command)
        assert not result["success"] and result["error"]["code"] == "unauthorized", result


async def test_personal_request_rejects_spoofed_owner_and_requires_admin_approval(
    hass, loaded_entry, hass_ws_client, hass_read_only_access_token, hass_read_only_user
):
    admin, personal, person = await setup_person(
        hass, loaded_entry, hass_ws_client, hass_read_only_access_token, hass_read_only_user
    )
    own = await request(personal, "renewal/self")
    assert own["success"] and own["result"]["name"] == "Personal record"
    assert all(
        secret not in json.dumps(own) for secret in (person.id, "918472", "718463", "assignments")
    )
    data = {
        "revision": person.revision,
        "until": "2036-01-01T00:00:00Z",
        "reason": "Continue work",
        "request_key": "a" * 32,
    }
    for spoof in ({"user_id": person.id}, {"actor": hass_read_only_user.id}):
        bad = await request(personal, "renewal/request", **data, **spoof)
        assert bad["error"]["code"] == "invalid_fields"
    result = await request(personal, "renewal/request", **data)
    assert result["success"], result
    row = result["result"]["requests"][0]
    assert row["state"] == "pending" and get_manager(hass).repository.get(
        person.id
    ).valid_until.startswith("2035")
    assert (await request(personal, "renewal/request", **data))["success"]
    denied = await request(personal, "workflows/renew_decide", request_id=row["id"], approve=True)
    assert denied["error"]["code"] == "unauthorized"
    approved = await request(admin, "workflows/renew_decide", request_id=row["id"], approve=True)
    assert approved["success"], approved
    assert get_manager(hass).repository.get(person.id).valid_until.startswith("2036")
    assert (await request(personal, "renewal/self"))["result"]["requests"][0]["state"] == "approved"


async def test_revoked_binding_and_inactive_owner_cannot_be_approved(
    hass, loaded_entry, hass_ws_client, hass_read_only_access_token, hass_read_only_user
):
    admin, personal, person = await setup_person(
        hass, loaded_entry, hass_ws_client, hass_read_only_access_token, hass_read_only_user
    )
    result = await request(
        personal,
        "renewal/request",
        revision=person.revision,
        until="2036-01-01T00:00:00Z",
        reason="Continue",
        request_key="b" * 32,
    )
    row = result["result"]["requests"][0]
    await personal.close()
    await hass.async_block_till_done()
    await hass.auth.async_update_user(hass_read_only_user, is_active=False)
    denied = await request(admin, "workflows/renew_decide", request_id=row["id"], approve=True)
    assert denied["error"]["code"] == "renewal_identity_inactive"
    await hass.auth.async_update_user(hass_read_only_user, is_active=True)
    refresh = await hass.auth.async_create_refresh_token(
        hass_read_only_user, client_id="https://renewal-reactivation.invalid"
    )
    personal = await hass_ws_client(hass, access_token=hass.auth.async_create_access_token(refresh))
    unlinked = await request(
        admin,
        "renewal/binding_update",
        account_id=hass_read_only_user.id,
        user_id="",
        revision=1,
        confirmed=True,
    )
    assert unlinked["success"]
    assert (await request(personal, "renewal/self"))["result"]["linked"] is False
    denied = await request(admin, "workflows/renew_decide", request_id=row["id"], approve=True)
    assert denied["error"]["code"] == "operation_not_found"
    assert get_manager(hass).repository.get(person.id).valid_until.startswith("2035")


async def test_binding_requires_confirmation_and_never_grants_operator_permissions(
    hass, loaded_entry, hass_ws_client, hass_read_only_access_token, hass_read_only_user
):
    admin = await hass_ws_client(hass)
    created = await get_manager(hass).async_create({"display_name": "Personal"})
    person = get_manager(hass).repository.get(created["id"])
    result = await request(
        admin,
        "renewal/binding_update",
        account_id=hass_read_only_user.id,
        user_id=person.id,
        revision=0,
        confirmed=False,
    )
    assert result["error"]["code"] == "confirmation_required"
    assert (await request(admin, "renewal/bindings"))["result"]["revision"] == 0
    result = await request(
        admin,
        "renewal/binding_update",
        account_id=hass_read_only_user.id,
        user_id=person.id,
        revision=0,
        confirmed=True,
    )
    assert result["success"]
    personal = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    assert not (await request(personal, "authorization/session"))["result"]["allowed"]
    assert (await request(personal, "overview"))["error"]["code"] == "unauthorized"


async def test_personal_request_needs_two_current_admins_when_policy_is_enabled(
    hass, loaded_entry, hass_ws_client, hass_read_only_access_token, hass_read_only_user
):
    from homeassistant.auth.const import GROUP_ID_ADMIN

    admin, personal, person = await setup_person(
        hass, loaded_entry, hass_ws_client, hass_read_only_access_token, hass_read_only_user
    )
    await hass.data[DOMAIN]["workflows"].update_settings(
        0, {"idle_minutes": 0, "reauth_sensitive": False, "dual_approval": True}
    )
    result = await request(
        personal,
        "renewal/request",
        revision=person.revision,
        until="2036-01-01T00:00:00Z",
        reason="Continue work",
        request_key="c" * 32,
    )
    identity = result["result"]["requests"][0]["id"]
    endorsed = await request(admin, "workflows/renew_decide", request_id=identity, approve=True)
    assert endorsed["success"] and endorsed["result"]["awaiting_second_approver"]
    assert get_manager(hass).repository.get(person.id).valid_until.startswith("2035")
    again = await request(admin, "workflows/renew_decide", request_id=identity, approve=True)
    assert again["error"]["code"] == "separate_approver_required"
    user = await hass.auth.async_create_user("Second administrator", group_ids=[GROUP_ID_ADMIN])
    refresh = await hass.auth.async_create_refresh_token(
        user, client_id="https://renewal-tests.invalid"
    )
    second = await hass_ws_client(hass, access_token=hass.auth.async_create_access_token(refresh))
    approved = await request(second, "workflows/renew_decide", request_id=identity, approve=True)
    assert approved["success"], approved
    assert get_manager(hass).repository.get(person.id).valid_until.startswith("2036")
