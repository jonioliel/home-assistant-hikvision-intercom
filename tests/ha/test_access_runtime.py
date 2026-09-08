"""Real HA Store persistence, administrator actions and entry lifecycle."""

import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant import config_entries
from homeassistant.core import Context, CoreState
from homeassistant.exceptions import ServiceValidationError, Unauthorized

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.access_runtime import get_manager
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.storage import AccessStore

from .conftest import DATA


async def finish_workers(manager):
    while tasks := [station.task for station in manager.stations.values() if station.task]:
        await asyncio.gather(*tasks)


async def test_store_roundtrip_private_and_preserves_revision(hass):
    store = AccessStore(hass)
    repo = AccessRepository(store.async_save)
    await repo.async_load(await store.async_load())
    user = await repo.async_create({"display_name": "Resident", "pin": "987654"})
    reloaded = AccessRepository(AccessStore(hass).async_save)
    await reloaded.async_load(await AccessStore(hass).async_load())
    assert reloaded.get(user.id).pin.value == "987654"
    assert "987654" not in str(reloaded.public())
    mode = await hass.async_add_executor_job(lambda: Path(store.path).stat().st_mode & 0o777)
    assert mode == 0o600


async def test_storage_error_prevents_repository_commit(hass):
    store = AccessStore(hass)
    repo = AccessRepository(store.async_save)
    await repo.async_load(None)
    before = repo.snapshot()
    with patch(
        "custom_components.hikvision_intercom.storage.write_utf8_file_atomic",
        side_effect=OSError("disk full"),
    ):
        with pytest.raises(AccessError, match="storage_write_failed"):
            await repo.async_create({"display_name": "Resident"})
    assert repo.snapshot() == before


@pytest.mark.parametrize("content", ["broken-json", "{}", '{"version":99,"data":{}}'])
async def test_corrupt_storage_is_preserved_and_never_replaced(hass, content):
    store = AccessStore(hass)

    def write():
        path = Path(store.path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    await hass.async_add_executor_job(write)
    with pytest.raises(AccessError, match="invalid_storage"):
        await store.async_load()
    assert await hass.async_add_executor_job(Path(store.path).read_text) == content


async def test_stopping_refuses_new_write_intent(hass):
    store = AccessStore(hass)
    state = hass.state
    try:
        hass.state = CoreState.stopping
        with pytest.raises(AccessError, match="storage_stopping"):
            await store.async_save({})
    finally:
        hass.state = state


async def test_setup_readonly_and_reload_keeps_one_manager(hass, loaded_entry, device_io):
    manager = get_manager(hass)
    await finish_workers(manager)
    device_io["write_person"].assert_not_called()
    device_io["unlock"].assert_not_called()
    await hass.config_entries.async_unload(loaded_entry.entry_id)
    station = manager.stations[loaded_entry.entry_id]
    assert station.driver is None and station.timer is None and station.task is None
    assert hass.services.has_service(DOMAIN, "sync_all")
    assert await hass.config_entries.async_setup(loaded_entry.entry_id)
    await finish_workers(manager)
    assert get_manager(hass) is manager
    assert len(manager.stations) == 1
    assert station.driver is loaded_entry.runtime_data.access_manager.stations[station.id].driver


@pytest.mark.parametrize(
    "service,data",
    [
        ("sync_all", {}),
        ("sync_station", {"station_id": "example"}),
        ("sync_user", {"user_id": "example"}),
        ("rescan_station", {"station_id": "example"}),
    ],
)
async def test_sync_actions_require_administrator(hass, loaded_entry, service, data):
    with patch.object(
        hass.auth, "async_get_user", AsyncMock(return_value=SimpleNamespace(is_admin=False))
    ):
        with pytest.raises(Unauthorized):
            await hass.services.async_call(
                DOMAIN, service, data, blocking=True, context=Context(user_id="reader")
            )


async def test_sync_target_validation_and_admin_queue(hass, loaded_entry):
    manager = get_manager(hass)
    await finish_workers(manager)
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(
            DOMAIN, "sync_station", {"station_id": "missing"}, blocking=True
        )
    await hass.services.async_call(
        DOMAIN, "sync_station", {"station_id": loaded_entry.entry_id}, blocking=True
    )
    await finish_workers(manager)
    assert manager.stations[loaded_entry.entry_id].status == "synced"


async def test_disabling_lock_requires_completed_access_removal(hass, loaded_entry):
    manager = get_manager(hass)
    await finish_workers(manager)
    # Persist desired ownership without sending credentials to a mocked physical station.
    await manager.repository.async_create(
        {"display_name": "Resident", "assignments": {loaded_entry.entry_id: {"allowed_locks": [1]}}}
    )
    result = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": config_entries.SOURCE_RECONFIGURE, "entry_id": loaded_entry.entry_id},
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {key: value for key, value in DATA.items() if key != "locks"}
    )
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"mode": "camera_only"}
    )
    assert result["errors"] == {"base": "access_removal_pending"}
    assert loaded_entry.data["locks"] == DATA["locks"]
