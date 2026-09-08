"""Admission, migration, deferred PIN ownership and repeated fleet recovery."""

import asyncio
from unittest.mock import AsyncMock

import httpx
import pytest
from test_access_engine import CAP, Device
from test_access_manager import drain

from custom_components.hikvision_intercom.access.manager import AccessManager
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.client.access import AccessClient
from custom_components.hikvision_intercom.client.client import ConnectionSettings, HikvisionClient
from custom_components.hikvision_intercom.hardening import (
    AdminLimiter,
    RequestMetrics,
    firmware_label,
)


def test_admission_concurrency_tokens_recovery_and_bounded_identities():
    limiter = AdminLimiter()
    admitted = [limiter.acquire("admin", 0) for _ in range(8)]
    with pytest.raises(AccessError, match="rate_limited"):
        limiter.acquire("admin", 0)
    for item in admitted:
        limiter.release(item)
    for _ in range(22):
        limiter.release(limiter.acquire("admin", 0))
    with pytest.raises(AccessError):
        limiter.acquire("admin", 0)
    limiter.release(limiter.acquire("admin", 1))
    for i in range(127):
        limiter.release(limiter.acquire(str(i), 1))
    with pytest.raises(AccessError):
        limiter.acquire("overflow", 1)
    limiter.release(limiter.acquire("later", 602))
    assert len(limiter.users) == 1


def test_request_metrics_are_bounded_and_private_free():
    metrics = RequestMetrics()
    for i in range(500):
        metrics.record(i / 1000, i % 2 == 0)
    data = metrics.public()
    assert data["requests"] == 500 and data["failures"] == 250 and data["sample_count"] == 100
    assert set(data) == {"requests", "failures", "sample_count", "last_ms", "p95_ms"}
    assert firmware_label("V3.9.0 build 260115") == "V3.9.0 build 260115"
    assert firmware_label("password=private-value") == "unknown"


async def test_migration_preserves_private_users_and_requires_durable_save():
    original = AccessRepository(AsyncMock())
    await original.async_load(None)
    user = await original.async_create({"display_name": "Demo", "pin": "847291"})
    legacy = original.snapshot()
    legacy["schema"] = 1
    del legacy["retired_pins"]
    save = AsyncMock()
    repo = AccessRepository(save)
    await repo.async_load(legacy)
    assert repo.get(user.id).pin.value == "847291"
    assert repo.snapshot()["schema"] == 2 and repo.snapshot()["retired_pins"] == {}
    assert save.await_count == 1 and legacy["schema"] == 1
    failed = AccessRepository(AsyncMock(side_effect=OSError("disk full")))
    with pytest.raises(OSError):
        await failed.async_load(legacy)
    assert not failed.users()


async def test_old_pin_reserved_until_every_station_confirms_replacement():
    repo = AccessRepository(AsyncMock())
    await repo.async_load(None)
    user = await repo.async_create(
        {
            "display_name": "Demo",
            "pin": "847291",
            "assignments": {"a": {"allowed_locks": [1]}, "b": {"allowed_locks": [1]}},
        }
    )
    await repo.async_update(user.id, {"pin": "917284"}, expected_revision=1)
    private = repo.snapshot()
    reloaded = AccessRepository(AsyncMock())
    await reloaded.async_load(private)

    async def reuse():
        return await reloaded.async_create({"display_name": "Other", "pin": "847291"})

    with pytest.raises(AccessError, match="pin_removal_pending"):
        await reuse()
    await reloaded.async_confirm_pin_removals("a", user.id, "917284")
    await reloaded.async_confirm_pin_removals("b", user.id, "847291")
    with pytest.raises(AccessError, match="pin_removal_pending"):
        await reuse()
    await reloaded.async_confirm_absent("b", user.id)
    assert (await reuse()).pin.value == "847291"
    assert "847291" not in str(reloaded.public())


async def test_pin_retirement_survives_deletion_and_deselected_station():
    repo = AccessRepository(AsyncMock())
    await repo.async_load(None)
    user = await repo.async_create(
        {"display_name": "Demo", "pin": "847291", "assignments": {"a": {"allowed_locks": [1]}}}
    )
    await repo.async_update(user.id, {"pin": None, "assignments": {}}, expected_revision=1)
    await repo.async_delete(user.id, expected_revision=2)
    assert repo.public()["tombstones"][0]["targets"] == ["a"]
    await repo.async_confirm_absent("a", user.id)
    assert not repo.snapshot()["retired_pins"] and not repo.public()["tombstones"]


async def test_malformed_ownership_journal_never_loaded():
    repo = AccessRepository(AsyncMock())
    await repo.async_load(None)
    user = await repo.async_create(
        {"display_name": "Demo", "assignments": {"a": {"allowed_locks": [1]}}}
    )
    await repo.async_bind("a", user.id, fingerprint="fingerprint")
    data = repo.snapshot()
    data["bindings"]["a"][user.id]["employee_no"] = "different-person"
    with pytest.raises(AccessError):
        await AccessRepository(AsyncMock()).async_load(data)
    await repo.async_delete(user.id, expected_revision=1)
    data = repo.snapshot()
    data["tombstones"][user.id]["confirmed"] = ["unexpected-station"]
    with pytest.raises(AccessError):
        await AccessRepository(AsyncMock()).async_load(data)


async def test_nine_station_repeated_pin_rotation_restart_and_offline_deletion():
    repo = AccessRepository(AsyncMock())
    await repo.async_load(None)
    devices = []
    sessions = []
    drivers = []

    def manager_for(repository):
        manager = AccessManager(repository)
        for number, driver in enumerate(drivers):
            manager.register(str(number), "Demo station", True)
            manager.attach(str(number), driver)
        return manager

    for _ in range(9):
        device = Device()
        devices.append(device)
        session = httpx.AsyncClient(transport=httpx.MockTransport(device.handle))
        sessions.append(session)
        driver = AccessClient(
            HikvisionClient(
                session,
                ConnectionSettings("192.0.2.10", "demo", "fake-secret"),
                enabled_doors=frozenset({1}),
            )
        )
        driver.capabilities = CAP
        driver.async_capabilities = AsyncMock(return_value=CAP)
        drivers.append(driver)
    manager = manager_for(repo)
    try:
        user = await manager.async_create(
            {
                "employee_no": "1001",
                "display_name": "Demo",
                "pin": "900000",
                "cards": [{"card_no": "1122334455", "label": "Demo"}],
                "assignments": {str(i): {"allowed_locks": [1]} for i in range(9)},
            }
        )
        await drain(manager)
        for cycle in range(1, 7):
            offline = cycle % 9
            devices[offline].offline = True
            current = repo.get(user["id"])
            await manager.async_update(
                current.id,
                {"pin": str(900000 + cycle), "display_name": f"Cycle {cycle}"},
                revision=current.revision,
            )
            await drain(manager)
            assert len(repo.snapshot()["retired_pins"]) == 1
            assert all(
                device.users["1001"]["localPassword"] == str(900000 + cycle)
                for index, device in enumerate(devices)
                if index != offline
            )
            persisted = repo.snapshot()
            await manager.async_close()
            repo = AccessRepository(AsyncMock())
            await repo.async_load(persisted)
            manager = manager_for(repo)
            await drain(manager)
            assert repo.get(user["id"]).assignments[str(offline)].sync_state == "offline"
            devices[offline].offline = False
            manager.request(str(offline))
            await drain(manager)
            assert not repo.snapshot()["retired_pins"]
            writes = sum(len(device.writes) for device in devices)
            manager.request_all()
            await drain(manager)
            assert sum(len(device.writes) for device in devices) == writes
        devices[0].offline = True
        await manager.async_delete(user["id"], revision=repo.get(user["id"]).revision)
        await drain(manager)
        assert len(repo.public()["tombstones"]) == 1
        devices[0].offline = False
        manager.request("0")
        await drain(manager)
        assert not repo.users() and not repo.public()["tombstones"]
        assert all(not device.users and not device.cards for device in devices)
    finally:
        await manager.async_close()
        await asyncio.gather(*(session.aclose() for session in sessions))
