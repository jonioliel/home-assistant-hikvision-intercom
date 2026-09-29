"""Real transport prevents bypassing the reviewed field-change path."""

from custom_components.hikvision_intercom.access_runtime import get_manager

from .test_websocket import request


async def test_existing_people_require_review_for_type_change(
    hass, loaded_entry, hass_ws_client, device_io
):
    client = await hass_ws_client(hass)
    current = await request(client, "profiles/settings_get")
    values = {k: v for k, v in current["result"].items() if k != "revision"}
    values["fields"] = [
        {
            "id": "room",
            "label": "Room",
            "enabled": True,
            "options": [],
            "type": "text",
            "required": False,
        }
    ]
    initial = await request(
        client, "profiles/settings_update", revision=current["result"]["revision"], values=values
    )
    assert initial["success"]
    person = await request(
        client,
        "users/create",
        data={"display_name": "Example", "profile": {"room": "Legacy"}},
        sync_now=False,
    )
    assert person["success"]
    values["fields"][0]["type"] = "number"
    blocked = await request(
        client, "profiles/settings_update", revision=initial["result"]["revision"], values=values
    )
    assert not blocked["success"] and blocked["error"]["code"] == "profile_review_required"
    review = await request(
        client, "profiles/settings_preview", revision=initial["result"]["revision"], values=values
    )
    assert review["success"] and review["result"]["requires_confirmation"]
    assert review["result"]["field_changes"][0]["invalid"] == 1
    applied = await request(
        client, "profiles/settings_apply", operation_id=review["result"]["operation_id"]
    )
    assert applied["success"]
    assert get_manager(hass).repository.get(person["result"]["id"]).profile == {"room": "Legacy"}
    device_io["unlock"].assert_not_called()
