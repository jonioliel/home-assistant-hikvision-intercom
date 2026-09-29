"""The real transport cannot bypass selected-field uniqueness."""

from .test_websocket import request


async def test_unique_metadata_is_rejected_through_real_transport(
    hass, loaded_entry, hass_ws_client, device_io
):
    client = await hass_ws_client(hass)
    current = await request(client, "profiles/settings_get")
    values = {k: v for k, v in current["result"].items() if k != "revision"}
    values["fields"] = [
        {
            "id": "external",
            "label": "External identity",
            "enabled": True,
            "options": [],
            "type": "text",
            "unique": True,
        }
    ]
    configured = await request(
        client, "profiles/settings_update", revision=current["result"]["revision"], values=values
    )
    assert configured["success"]
    first = await request(
        client,
        "users/create",
        data={"display_name": "First", "profile": {"external": "A-123"}},
        sync_now=False,
    )
    assert first["success"]
    second = await request(
        client,
        "users/create",
        data={"display_name": "Second", "profile": {"external": "a-123"}},
        sync_now=False,
    )
    assert not second["success"] and second["error"]["code"] == "profile_value_not_unique"
    assert "A-123" not in str(second)
    device_io["unlock"].assert_not_called()
