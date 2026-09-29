"""All supported repository generations preserve desired access and safe ownership."""

from copy import deepcopy
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.access.repository import AccessRepository


@pytest.mark.parametrize("schema", range(1, 15))
async def test_every_supported_schema_upgrades_without_losing_credentials_or_permissions(schema):
    original = AccessRepository(AsyncMock())
    await original.async_load(None)
    await original.async_create(
        {
            "display_name": "Upgrade matrix",
            "employee_no": "1001",
            "pin": "827361",
            "cards": [{"card_no": "92837162"}],
            "assignments": {"station": {"allowed_locks": [1, 2]}},
        }
    )
    state = original.snapshot()
    expected = deepcopy(state["users"])
    state["schema"] = schema
    if schema < 14:
        state.pop("station_lifecycles", None)
    if schema < 13:
        state.pop("workflows")
    if schema < 12:
        state.pop("checkpoint_jobs")
    if schema < 11:
        state.pop("visit_requests")
    if schema < 8:
        state.pop("sync_operations")
    if schema < 5:
        state.pop("profile_settings")
    if schema < 3:
        state.pop("admin_audit")
        state.pop("operation_receipts")
    if schema < 2:
        state.pop("retired_pins")
    # Before group inheritance, effective direct assignments were the source of truth.
    if schema < 5:
        for person in state["users"].values():
            person.pop("permission_overrides")
    save = AsyncMock()
    upgraded = AccessRepository(save)
    await upgraded.async_load(state)
    assert upgraded.snapshot()["schema"] == 14
    for identity, person in expected.items():
        restored = upgraded.snapshot()["users"][identity]
        for key in ("display_name", "employee_no", "pin", "cards", "assignments", "revision"):
            assert restored[key] == person[key]
    # A second startup is a no-op and must not repeatedly rewrite migrated data.
    second_save = AsyncMock()
    second = AccessRepository(second_save)
    await second.async_load(upgraded.snapshot())
    second_save.assert_not_awaited()
    assert second.snapshot() == upgraded.snapshot()


async def test_preupgrade_copy_restores_matching_data_without_modifying_live_repository():
    original = AccessRepository(AsyncMock())
    await original.async_load(None)
    person = await original.async_create(
        {"employee_no": "1001", "display_name": "Backup copy", "pin": "827361"}
    )
    backup = original.snapshot()
    backup["schema"] = 11
    backup.pop("station_lifecycles", None)
    backup.pop("workflows")
    backup.pop("checkpoint_jobs")
    saved_copy = deepcopy(backup)
    live = AccessRepository(AsyncMock())
    await live.async_load(backup)
    await live.async_update(person.id, {"active": False}, expected_revision=person.revision)
    restored_copy = AccessRepository(AsyncMock())
    await restored_copy.async_load(deepcopy(saved_copy))
    assert restored_copy.get(person.id).active
    assert restored_copy.get(person.id).pin.value == "827361"
    assert not live.get(person.id).active
    assert saved_copy["schema"] == 11 and "workflows" not in saved_copy
