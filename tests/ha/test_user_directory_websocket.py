"""Exercise the paginated user directory through Home Assistant WebSocket."""

from unittest.mock import patch

from custom_components.hikvision_intercom.access_runtime import get_manager
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.panel_permissions import AREAS, FIELDS


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


async def test_summary_keeps_legacy_contract_without_serializing_people(
    hass, loaded_entry, hass_ws_client
):
    manager = get_manager(hass)
    await manager.repository.async_create({"display_name": "Private Person", "pin": "700001"})
    client = await hass_ws_client(hass)
    with patch.object(
        manager.repository, "users", side_effect=AssertionError("summary serialized people")
    ):
        response = await request(client, "overview/summary")
    assert response["success"], response
    data = response["result"]
    assert data["user_count"] == 1 and data["users"] == [] and not data["users_complete"]
    assert "overview_summary" in data["api"]["capabilities"]
    assert "overview/summary" in data["api"]["commands"]
    assert "Private Person" not in str(response) and "700001" not in str(response)
    legacy = (await request(client, "overview"))["result"]
    assert legacy["users"][0]["display_name"] == "Private Person"
    assert legacy["stations"] == data["stations"]


async def test_summary_count_obeys_station_scope_and_people_area(
    hass, loaded_entry, hass_ws_client, hass_read_only_user, hass_read_only_access_token
):
    manager = get_manager(hass)
    manager.register("outside", "Other", True)
    for station in (loaded_entry.entry_id, "outside"):
        await manager.repository.async_create(
            {"display_name": station, "assignments": {station: {"allowed_locks": [1]}}}
        )
    permissions = hass.data[DOMAIN]["panel_permissions"]
    areas = dict.fromkeys(AREAS, "view")
    policy = {
        "enabled": True,
        "areas": areas,
        "station_ids": [loaded_entry.entry_id],
        "fields": dict.fromkeys(FIELDS, "none"),
    }
    await permissions.update(
        permissions.revision, {hass_read_only_user.id: policy}, [hass_read_only_user.id]
    )
    client = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    summary = (await request(client, "overview/summary"))["result"]
    assert summary["user_count"] == 1 and summary["users"] == []
    assert [item["id"] for item in summary["stations"]] == [loaded_entry.entry_id]
    assert "outside" not in str(summary)
    areas["users"] = "none"
    await permissions.update(
        permissions.revision, {hass_read_only_user.id: policy}, [hass_read_only_user.id]
    )
    assert (await request(client, "overview/summary"))["result"]["user_count"] == 0
