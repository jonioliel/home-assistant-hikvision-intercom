"""Lifecycle review through real authenticated infrastructure, with mocked device I/O."""

from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.station_lifecycle_api import review_lifecycle

from .test_operations_center import request


async def test_lifecycle_review_is_admin_only_and_has_no_device_or_storage_writes(
    hass, loaded_entry, hass_ws_client, hass_read_only_access_token, device_io
):
    manager = hass.data[DOMAIN]["access"]
    await manager.repository.async_create(
        {
            "display_name": "Lifecycle person",
            "assignments": {loaded_entry.entry_id: {"enabled": True}},
        }
    )
    await hass.async_block_till_done()
    before = deepcopy(manager.repository.snapshot())
    client = await hass_ws_client(hass)
    device_io["write_person"].reset_mock()
    with patch(
        "custom_components.hikvision_intercom.client.access.AccessClient.async_delete_person",
        AsyncMock(),
    ) as delete_person:
        result = await request(
            client, "platform/lifecycle_review", source_id=loaded_entry.entry_id, target_id=""
        )
    delete_person.assert_not_awaited()
    assert result["success"]
    review = result["result"]
    assert review["affected_people"] == 1 and review["read_only"] and not review["can_apply"]
    assert review["stations"][0]["identity_verified"]
    assert manager.repository.snapshot() == before
    device_io["write_person"].assert_not_awaited()
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    denied = await request(
        reader, "platform/lifecycle_review", source_id=loaded_entry.entry_id, target_id=""
    )
    assert not denied["success"] and denied["error"]["code"] == "unauthorized"


async def test_lifecycle_review_rejects_admin_revocation_after_identity_read(
    hass, loaded_entry, hass_admin_user
):
    revoked = SimpleNamespace(is_active=False, is_admin=True)
    identity = AsyncMock()
    with (
        patch.object(loaded_entry.runtime_data.client, "async_confirm_identity", identity),
        patch.object(hass.auth, "async_get_user", AsyncMock(return_value=revoked)),
    ):
        with pytest.raises(AccessError, match="unauthorized"):
            await review_lifecycle(
                hass,
                {"source_id": loaded_entry.entry_id, "target_id": ""},
                hass_admin_user.id,
            )
    identity.assert_awaited_once()


async def test_lifecycle_review_refuses_same_station_without_identity_read(
    hass, loaded_entry, hass_ws_client
):
    client = await hass_ws_client(hass)
    with patch.object(
        loaded_entry.runtime_data.client, "async_confirm_identity", AsyncMock()
    ) as identity:
        result = await request(
            client,
            "platform/lifecycle_review",
            source_id=loaded_entry.entry_id,
            target_id=loaded_entry.entry_id,
        )
    assert not result["success"] and result["error"]["code"] == "invalid_fields"
    identity.assert_not_awaited()
