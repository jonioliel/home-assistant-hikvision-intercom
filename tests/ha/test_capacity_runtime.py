"""Cached complete observations do not initiate another inventory or expose identity."""

from unittest.mock import AsyncMock, patch

from custom_components.hikvision_intercom.capacity_runtime import observe
from custom_components.hikvision_intercom.const import DOMAIN

from .test_operations_center import request


async def test_cached_capacity_is_admin_only_and_no_new_network_scan(
    hass, loaded_entry, hass_ws_client, hass_read_only_access_token, device_io
):
    manager = hass.data[DOMAIN]["access"]
    await manager.async_rescan(loaded_entry.entry_id)
    scanned_at = manager.stations[loaded_entry.entry_id].scanned_at
    device_io["inventory"].reset_mock()
    with patch.object(
        loaded_entry.runtime_data.client, "async_confirm_identity", AsyncMock()
    ) as identity:
        await observe(hass)
        await observe(hass)
        client = await hass_ws_client(hass)
        result = await request(client, "platform/capacity")
        assert result["success"], result
        record = next(
            r for r in result["result"]["records"] if r["station_id"] == loaded_entry.entry_id
        )
        assert record["sampled_at"] == scanned_at
        assert record["sample_count"] == 1
        assert (
            record["users"]["advertised_limit"]
            == manager.stations[loaded_entry.entry_id].driver.capabilities.max_users
        )
        assert record["programs"]["advertised_limit"] is None
        assert "identity_stamp" not in record
        identity.assert_not_awaited()
        device_io["inventory"].assert_not_awaited()
        reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
        assert not (await request(reader, "platform/capacity"))["success"]
