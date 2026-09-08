"""Actual HA migration, Repairs and private-free diagnostics behavior."""

from copy import deepcopy
from dataclasses import replace
from unittest.mock import patch

import pytest
from homeassistant.helpers import issue_registry as ir
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.hikvision_intercom.access_runtime import get_manager
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.diagnostics import async_get_config_entry_diagnostics
from custom_components.hikvision_intercom.migrations import async_migrate_entry

from .conftest import DATA, PROFILE
from .test_access_runtime import finish_workers


async def test_entry_migration_preserves_all_credentials_and_permissions(hass):
    entry = MockConfigEntry(domain=DOMAIN, data=deepcopy(DATA), version=1, minor_version=1)
    entry.add_to_hass(hass)
    before = dict(entry.data)
    assert await async_migrate_entry(hass, entry)
    assert entry.version == 1 and entry.minor_version == 2 and dict(entry.data) == before
    assert await async_migrate_entry(hass, entry)


@pytest.mark.parametrize(
    "version,minor,data",
    [
        (2, 1, DATA),
        (1, 3, DATA),
        (1, 1, {**DATA, "locks": [{"physical_index": 2, "api_id": 2, "confirmed": True}]}),
    ],
)
async def test_unsupported_migration_does_not_change_saved_data(hass, version, minor, data):
    entry = MockConfigEntry(domain=DOMAIN, data=data, version=version, minor_version=minor)
    entry.add_to_hass(hass)
    before = dict(entry.data)
    assert not await async_migrate_entry(hass, entry)
    assert entry.version == version and entry.minor_version == minor and dict(entry.data) == before
    assert ir.async_get(hass).async_get_issue(DOMAIN, f"{entry.entry_id}_migration")


async def test_capability_regression_has_actionable_issue_then_clears(
    hass, loaded_entry, device_io
):
    assert loaded_entry.data["capability_baseline"]["snapshot"]
    await hass.config_entries.async_unload(loaded_entry.entry_id)
    device_io["profile"].return_value = replace(PROFILE, snapshot=False)
    assert await hass.config_entries.async_setup(loaded_entry.entry_id)
    await hass.async_block_till_done()
    key = f"{loaded_entry.entry_id}_capability_regression"
    assert ir.async_get(hass).async_get_issue(DOMAIN, key)
    await hass.config_entries.async_unload(loaded_entry.entry_id)
    device_io["profile"].return_value = PROFILE
    assert await hass.config_entries.async_setup(loaded_entry.entry_id)
    await hass.async_block_till_done()
    assert ir.async_get(hass).async_get_issue(DOMAIN, key) is None


async def test_conflict_repair_waits_and_transient_offline_has_no_issue(hass, loaded_entry):
    manager = get_manager(hass)
    await finish_workers(manager)
    user = await manager.repository.async_create(
        {"display_name": "Resident", "assignments": {loaded_entry.entry_id: {"allowed_locks": [1]}}}
    )
    watcher = hass.data[DOMAIN]["repairs"]
    await manager.repository.async_mark(
        loaded_entry.entry_id, user.id, "offline", "connection_failed"
    )
    watcher.refresh()
    key = f"{loaded_entry.entry_id}_sync_conflict"
    assert ir.async_get(hass).async_get_issue(DOMAIN, key) is None
    await manager.repository.async_mark(
        loaded_entry.entry_id, user.id, "conflict", "device_changed"
    )
    watcher.refresh()
    assert ir.async_get(hass).async_get_issue(DOMAIN, key) is None
    watcher.first_conflict[loaded_entry.entry_id] -= 301
    watcher.refresh()
    assert ir.async_get(hass).async_get_issue(DOMAIN, key)
    await manager.repository.async_mark(loaded_entry.entry_id, user.id, "synced")
    watcher.refresh()
    assert ir.async_get(hass).async_get_issue(DOMAIN, key) is None


async def test_diagnostics_include_metrics_counts_not_private_values(hass, loaded_entry):
    manager = get_manager(hass)
    await finish_workers(manager)
    await manager.repository.async_create(
        {
            "display_name": "Private Person",
            "employee_no": "ABC1234",
            "pin": "847291",
            "cards": [{"card_no": "9988776655", "label": "Secret card"}],
        }
    )
    runtime = loaded_entry.runtime_data
    runtime.client.metrics.record(0.125, False)
    runtime.client.metrics.record(0.75, True)
    result = await async_get_config_entry_diagnostics(hass, loaded_entry)
    assert result["requests"]["requests"] == 2 and result["requests"]["failures"] == 1
    assert result["access"]["capabilities"]["cards_per_person"] == 5
    for secret in [
        "Private Person",
        "ABC1234",
        "847291",
        "9988776655",
        "Secret card",
        DATA["host"],
        DATA["password"],
        PROFILE.serial,
    ]:
        assert secret not in str(result)


async def test_independent_storage_issue_clears_only_after_matching_success(hass, loaded_entry):
    from custom_components.hikvision_intercom.access.models import AccessError
    from custom_components.hikvision_intercom.storage import AccessStore

    users = AccessStore(hass)
    events = AccessStore(hass, key=f"{DOMAIN}.events")
    data = await users.async_load()
    with patch.object(users, "_save_strict", side_effect=AccessError("storage_write_failed")):
        with pytest.raises(AccessError):
            await users.async_save(data)
    registry = ir.async_get(hass)
    assert registry.async_get_issue(DOMAIN, "users_storage_write")
    await events.async_save(await events.async_load())
    assert registry.async_get_issue(DOMAIN, "users_storage_write")
    await users.async_save(data)
    assert registry.async_get_issue(DOMAIN, "users_storage_write") is None
