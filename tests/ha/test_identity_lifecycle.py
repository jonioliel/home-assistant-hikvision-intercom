"""Real HA lifecycle reports, privacy and duplicate preview."""

import json
from datetime import UTC, datetime, timedelta

from custom_components.smplwise_access_control.access_runtime import get_manager

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
