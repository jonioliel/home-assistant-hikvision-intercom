"""Exercise the paginated user directory through Home Assistant WebSocket."""

from custom_components.smplwise_access_control.access_runtime import get_manager
from custom_components.smplwise_access_control.const import DOMAIN


async def request(client, command, **data):
    await client.send_json_auto_id({"type": f"{DOMAIN}/{command}", **data})
    return await client.receive_json()


async def test_user_query_is_advertised_bounded_and_secret_free(hass, loaded_entry, hass_ws_client):
    manager = get_manager(hass)
    for index in range(55):
        await manager.repository.async_create(
            {
                "display_name": f"Scale Person {index:02d}",
                "phone": f"050{index:07d}",
                "pin": f"{700000 + index}",
            }
        )

    client = await hass_ws_client(hass)
    overview = await request(client, "overview")
    assert "user_directory_query" in overview["result"]["api"]["capabilities"]
    assert "users/query" in overview["result"]["api"]["commands"]
    first = await request(
        client,
        "users/query",
        query="Scale Person",
        filters={"sort": "name"},
        offset=0,
        limit=25,
        snapshot="",
    )
    assert first["success"]
    page = first["result"]
    assert page["total"] == page["total_all"] == 55
    assert len(page["records"]) == 25 and page["next_offset"] == 25
    assert all(item["pin_configured"] for item in page["records"])
    assert "700000" not in str(first)

    invalid = await request(
        client,
        "users/query",
        query="",
        filters={"sort": "employee"},
        offset=0,
        limit=201,
        snapshot=page["snapshot"],
    )
    assert not invalid["success"] and invalid["error"]["code"] == "invalid_fields"
