"""Exercise new workflows and fresh authentication with the actual HA runtime."""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pyotp
import pytest
from homeassistant import auth
from homeassistant.auth.const import GROUP_ID_ADMIN

from custom_components.hikvision_intercom.access.manager import AccessManager
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.access.workflows import Workflows
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.panel_security import PanelSecurity


async def request(client, route, **data):
    await client.send_json_auto_id({"type": f"{DOMAIN}/{route}", **data})
    return await client.receive_json()


class Connection:
    def __init__(self, user):
        self.user = user
        self.subscriptions = {}


@pytest.mark.parametrize("mfa", [False, True])
async def test_real_password_and_totp_are_required_and_connection_bound(hass, mfa):
    manager = await auth.auth_manager_from_config(
        hass, [{"type": "homeassistant"}], [{"type": "totp"}] if mfa else []
    )
    provider = manager.get_auth_provider("homeassistant", None)
    await provider.async_add_auth("operator", "correct-test-password")
    credential = await provider.async_get_or_create_credentials({"username": "operator"})
    user = await manager.async_create_user("Operator", group_ids=[GROUP_ID_ADMIN])
    await manager.async_link_user(user, credential)
    secret = pyotp.random_base32()
    if mfa:
        await manager.async_enable_user_mfa(user, "totp", {"secret": secret})
    repo = AccessRepository(AsyncMock())
    await repo.async_load(None)
    center = Workflows(AccessManager(repo))
    await center.update_settings(
        0, {"idle_minutes": 1, "reauth_sensitive": True, "dual_approval": False}
    )
    security = PanelSecurity(SimpleNamespace(auth=manager), center)
    connection, second = Connection(user), Connection(user)
    assert security.public(connection)["locked"]
    first = await security.dispatch(connection, "security/reauth_start", {})
    wrong = await security.dispatch(
        connection,
        "security/reauth_step",
        {"flow_id": first["flow_id"], "values": {"password": "wrong-test-password"}},
    )
    assert wrong["errors"] and security.public(connection)["locked"]
    step = await security.dispatch(
        connection,
        "security/reauth_step",
        {"flow_id": wrong["flow_id"], "values": {"password": "correct-test-password"}},
    )
    if mfa:
        assert not step["authenticated"] and security.public(connection)["locked"]
        assert [f["name"] for f in step["fields"]] == ["code"]
        wrong_code = await security.dispatch(
            connection,
            "security/reauth_step",
            {"flow_id": step["flow_id"], "values": {"code": "invalid"}},
        )
        assert not wrong_code["authenticated"]
        step = await security.dispatch(
            connection,
            "security/reauth_step",
            {"flow_id": wrong_code["flow_id"], "values": {"code": pyotp.TOTP(secret).now()}},
        )
    assert step["authenticated"] and security.public(connection)["elevated"]
    assert security.public(second)["locked"] and not security.public(second)["elevated"]
    assert "correct-test-password" not in json.dumps(step)
    security.session(connection)["last_activity"] -= 61
    with pytest.raises(AccessError, match="screen_locked"):
        security.guard(connection, "overview", False)
    await security.dispatch(connection, "security/touch", {})
    assert security.public(connection)["locked"]
    await center.manager.async_close()


async def test_websocket_lock_blocks_read_write_and_reconnect(hass, loaded_entry, hass_ws_client):
    client = await hass_ws_client(hass)
    assert (await request(client, "overview"))["success"]
    assert (await request(client, "security/lock"))["result"]["locked"]
    for command, values in (("overview", {}), ("users/create", {"data": {"display_name": "No"}})):
        result = await request(client, command, **values)
        assert not result["success"] and result["error"]["code"] == "screen_locked"
    center = hass.data[DOMAIN]["workflows"]
    await center.update_settings(
        0, {"idle_minutes": 1, "reauth_sensitive": False, "dual_approval": False}
    )
    second = await hass_ws_client(hass)
    session = await request(second, "authorization/session")
    assert session["result"]["security"]["locked"]
    assert (await request(second, "overview"))["error"]["code"] == "screen_locked"


async def test_general_approval_rejects_bypasses_and_preserves_credentials(
    hass, loaded_entry, hass_ws_client
):
    client = await hass_ws_client(hass)
    center = hass.data[DOMAIN]["workflows"]
    repo = center.repository
    person = await repo.async_create({"display_name": "Reviewed", "pin": "847291"})
    await center.update_settings(
        0, {"idle_minutes": 0, "reauth_sensitive": False, "dual_approval": True}
    )
    result = await request(
        client, "cards/add", user_id=person.id, revision=person.revision, data={"card_no": "726384"}
    )
    assert result["error"]["code"] == "approval_required" and not repo.get(person.id).cards
    submitted = await request(
        client,
        "workflows/submit",
        command="cards/add",
        values={"user_id": person.id, "revision": person.revision, "data": {"card_no": "726384"}},
        label="Issue card",
    )
    assert submitted["success"], submitted
    assert "726384" not in json.dumps(submitted) and "847291" not in json.dumps(submitted)
    rid = submitted["result"]["id"]
    self_approve = await request(client, "workflows/decide", request_id=rid, approve=True)
    assert self_approve["error"]["code"] == "separate_approver_required"
    reviewer = await hass.auth.async_create_user("Reviewer", group_ids=[GROUP_ID_ADMIN])
    await center.decide(reviewer.id, rid, True)
    applied = await request(client, "workflows/apply", request_id=rid)
    assert applied["success"], applied
    assert repo.get(person.id).cards[0].card_no.value == "726384"
    assert repo.get(person.id).pin.value == "847291"
    create = await request(client, "users/create", data={"display_name": "Bypass"})
    assert create["error"]["code"] == "approval_required"
    await center.update_settings(
        1, {"idle_minutes": 0, "reauth_sensitive": False, "dual_approval": False}
    )
