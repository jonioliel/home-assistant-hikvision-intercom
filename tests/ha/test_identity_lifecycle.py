"""Real HA lifecycle reports, privacy and duplicate preview."""

import json
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from custom_components.hikvision_intercom.access_runtime import get_manager

from .test_websocket import request


async def test_lifecycle_report_and_duplicate_preview_are_privacy_safe(
    hass, loaded_entry, hass_ws_client
):
    manager = get_manager(hass)
    now = datetime.now(UTC)
    first = await manager.repository.async_create(
        {
            "display_name": "Dana Cohen",
            "phone": "050-123-4567",
            "pin": "847291",
            "cards": [{"card_no": "000077779999"}],
            "valid_from": (now - timedelta(days=1)).isoformat(),
            "valid_until": (now + timedelta(days=7)).isoformat(),
        }
    )
    await manager.repository.async_create(
        {
            "display_name": " dana  cohen ",
            "phone": "0501234567",
            "cards": [{"card_no": "123459999"}],
        }
    )
    await manager.repository.async_create({"display_name": "No credential"})

    client = await hass_ws_client(hass)
    lifecycle = await request(client, "users/lifecycle", warning_days=30)
    assert lifecycle["success"]
    result = lifecycle["result"]
    assert result["summary"]["total"] == 3
    assert result["summary"]["expiring"] == 1
    assert result["summary"]["without_credentials"] == 1
    assert result["summary"]["duplicate_groups"] == 3
    assert result["privacy"] == "no_pin_or_complete_card_values"

    preview = await request(
        client,
        "users/duplicate_check",
        user_id="",
        data={
            "employee_no": "9000",
            "display_name": "DANA COHEN",
            "phone": "050 123 4567",
            "card_suffixes": ["9999"],
        },
    )
    assert preview["success"] and preview["result"]["total"] == 2
    assert not preview["result"]["blocking"]
    assert {reason for row in preview["result"]["matches"] for reason in row["reasons"]} == {
        "display_name",
        "phone",
        "card_last4",
    }
    wire = json.dumps({"lifecycle": lifecycle, "preview": preview})
    assert first.id in wire
    for secret in ("847291", "000077779999", "123459999"):
        assert secret not in wire


async def test_lifecycle_validates_horizon_and_advertises_capability(
    hass, loaded_entry, hass_ws_client
):
    client = await hass_ws_client(hass)
    overview = await request(client, "overview")
    api = overview["result"]["api"]
    assert "identity_lifecycle" in api["capabilities"]
    assert {"users/lifecycle", "users/duplicate_check"} <= set(api["commands"])

    invalid = await request(client, "users/lifecycle", warning_days=0)
    assert not invalid["success"] and invalid["error"]["code"] == "invalid_fields"


async def test_temporary_lifecycle_renewal_reuses_sync_queue_and_viewer_cannot_write(
    hass, loaded_entry, hass_ws_client, hass_read_only_access_token, hass_read_only_user
):
    manager = get_manager(hass)
    now = datetime.now(UTC)
    person = await manager.repository.async_create(
        {
            "display_name": "Visitor",
            "access_category": "visitor",
            "responsible_person": "Reception",
            "pin": "743829",
            "valid_from": (now - timedelta(days=2)).isoformat(),
            "valid_until": (now - timedelta(days=1)).isoformat(),
        }
    )
    admin = await hass_ws_client(hass)
    response = await request(admin, "users/lifecycle", warning_days=30)
    temporary = response["result"]["temporary_access"]
    assert temporary["summary"]["expired"] == 1
    assert temporary["users"][0]["revision"] == person.revision
    assert "743829" not in json.dumps(response)
    periods = {"valid_from": now.isoformat(), "valid_until": (now + timedelta(days=1)).isoformat()}
    with patch.object(manager, "request_user") as queued:
        renewed = await request(
            admin,
            "users/update",
            user_id=person.id,
            revision=person.revision,
            data=periods,
            sync_now=True,
        )
        assert renewed["success"], renewed
        queued.assert_called_once_with(person.id)
    assert manager.repository.get(person.id).pin.value == "743829"
    saved = await request(
        admin,
        "authorization/settings_update",
        revision=0,
        users={
            hass_read_only_user.id: {
                "enabled": True,
                "areas": {
                    "overview": "none",
                    "users": "view",
                    "events": "none",
                    "stations": "none",
                    "management": "view",
                },
            },
        },
    )
    assert saved["success"]
    viewer = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    assert (await request(viewer, "users/lifecycle", warning_days=30))["success"]
    denied = await request(
        viewer,
        "users/update",
        user_id=person.id,
        revision=renewed["result"]["revision"],
        data=periods,
        sync_now=True,
    )
    assert not denied["success"] and denied["error"]["code"] == "unauthorized"
