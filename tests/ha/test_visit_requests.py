"""Real transport, operator eligibility and host-bound approval, with device I/O mocked."""

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from custom_components.hikvision_intercom.access_runtime import get_manager

from .test_websocket import request


async def host_permission(admin, user_id, revision=0, level="manage"):
    areas = {area: "none" for area in ("overview", "users", "events", "stations", "management")}
    result = await request(
        admin,
        "authorization/settings_update",
        revision=revision,
        users={user_id: {"enabled": True, "areas": {**areas, "users": level}}},
    )
    assert result["success"], result


def guest(station_id):
    now = datetime.now(UTC)
    return {
        "display_name": "Approval guest",
        "active": True,
        "access_category": "visitor",
        "responsible_person": "Reception",
        "valid_from": now.isoformat(),
        "valid_until": (now + timedelta(hours=2)).isoformat(),
        "pin": "786453",
        "assignments": {station_id: {"allowed_locks": [1]}},
    }


async def test_host_approval_creates_inactive_guest_and_only_host_can_activate(
    hass,
    loaded_entry,
    hass_ws_client,
    hass_read_only_access_token,
    hass_read_only_user,
):
    admin = await hass_ws_client(hass)
    await host_permission(admin, hass_read_only_user.id)
    host = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    manager = get_manager(hass)
    operators = await request(admin, "visits/operators")
    assert operators["success"] and hass_read_only_user.id in {
        operator["id"] for operator in operators["result"]["operators"]
    }
    with patch.object(manager, "request_user") as queued:
        created = await request(
            admin,
            "visits/create",
            data=guest(loaded_entry.entry_id),
            approver_id=hass_read_only_user.id,
        )
        assert created["success"] and not created["result"]["active"], created
        queued.assert_not_called()
        row = (await request(host, "visits/list", offset=0, limit=100))["result"]["items"][0]
        own = await request(
            host,
            "visits/list",
            offset=0,
            limit=100,
            filters={"status": "pending", "scope": "approver"},
        )
        assert own["success"] and own["result"]["total"] == 1
        other = await request(
            admin, "visits/list", offset=0, limit=100, filters={"scope": "approver"}
        )
        assert other["success"] and other["result"]["total"] == 0
        spoof = await request(host, "visits/list", offset=0, limit=100, filters={"actor": "other"})
        assert not spoof["success"] and spoof["error"]["code"] == "invalid_fields"
        assert "786453" not in str(row) and row["approver_id"] == hass_read_only_user.id
        denied = await request(
            admin, "visits/decide", request_id=row["id"], revision=1, decision="approve"
        )
        assert not denied["success"] and denied["error"]["code"] == "unauthorized"
        bypass = await request(
            admin,
            "users/set_active",
            user_id=row["user_id"],
            revision=created["result"]["revision"],
            active=True,
        )
        assert not bypass["success"] and bypass["error"]["code"] == "visit_approval_required"
        approved = await request(
            host, "visits/decide", request_id=row["id"], revision=1, decision="approve"
        )
        assert approved["success"] and approved["result"]["status"] == "approved", approved
        queued.assert_called_once_with(row["user_id"])
        assert manager.repository.get(row["user_id"]).active


async def test_revoked_or_read_only_host_cannot_approve_and_unknown_host_cannot_create(
    hass,
    loaded_entry,
    hass_ws_client,
    hass_read_only_access_token,
    hass_read_only_user,
):
    admin = await hass_ws_client(hass)
    unknown = await request(
        admin, "visits/create", data=guest(loaded_entry.entry_id), approver_id="missing"
    )
    assert not unknown["success"] and unknown["error"]["code"] == "visit_approver_unavailable"
    manager = get_manager(hass)
    assert manager.repository.users() == []
    await host_permission(admin, hass_read_only_user.id)
    host = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    created = await request(
        admin,
        "visits/create",
        data=guest(loaded_entry.entry_id),
        approver_id=hass_read_only_user.id,
    )
    assert created["success"], created
    row = manager.repository.visit_requests()["items"][0]
    await host_permission(admin, hass_read_only_user.id, revision=1, level="view")
    assert (await request(host, "visits/list", offset=0, limit=100))["success"]
    with patch.object(manager, "request_user") as queued:
        denied = await request(
            host, "visits/decide", request_id=row["id"], revision=1, decision="approve"
        )
        assert not denied["success"] and denied["error"]["code"] == "unauthorized"
        queued.assert_not_called()
    assert not manager.repository.get(row["user_id"]).active
    assert (await request(admin, "authorization/settings_update", revision=2, users={}))["success"]
    assert not (await request(host, "visits/list", offset=0, limit=100))["success"]


async def test_self_approval_and_unconfigured_door_leave_no_partial_user(
    hass,
    loaded_entry,
    hass_ws_client,
    hass_read_only_user,
):
    admin = await hass_ws_client(hass)
    manager = get_manager(hass)
    operators = (await request(admin, "visits/operators"))["result"]["operators"]
    admin_id = next(item["id"] for item in operators if item["id"] != hass_read_only_user.id)
    same = await request(
        admin, "visits/create", data=guest(loaded_entry.entry_id), approver_id=admin_id
    )
    assert not same["success"] and same["error"]["code"] == "visit_second_operator_required"
    await host_permission(admin, hass_read_only_user.id)
    wrong = await request(
        admin, "visits/create", data=guest("missing"), approver_id=hass_read_only_user.id
    )
    assert not wrong["success"] and wrong["error"]["code"] == "station_not_found"
    assert manager.repository.users() == [] and manager.repository.visit_requests()["total"] == 0
