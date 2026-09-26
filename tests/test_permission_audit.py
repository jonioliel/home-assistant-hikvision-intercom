"""Audit compares real normalizers with simulated station I/O and never reconciles."""

from copy import deepcopy
from unittest.mock import AsyncMock

import pytest
from test_access_client import PERSON
from test_access_engine import create_user  # noqa: F401
from test_access_engine import setup as setup

from custom_components.hikvision_intercom.access.manager import AccessManager
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.permission_audit import inspect_permissions


@pytest.fixture
async def audit_fleet(setup):
    repo, device, driver, engine = setup
    user = await create_user(repo)
    await engine.async_reconcile("a", driver)
    device.writes.clear()
    driver.client.async_confirm_identity = AsyncMock()
    driver.async_capabilities = AsyncMock(return_value=driver.capabilities)
    manager = AccessManager(repo)
    manager.register("a", "Gate", True)
    manager.stations["a"].driver = driver
    yield manager, device, driver, user
    await manager.async_close()


async def test_permission_audit_matches_and_detects_drift_without_writing(audit_fleet):
    manager, device, _driver, user = audit_fleet
    before = manager.repository.snapshot()
    report = await inspect_permissions(manager, "a")
    assert report["counts"] == {"matched": 1, "drift": 0, "unmanaged": 0, "unverified": 0}
    device.users[user.employee_no]["name"] = "Manual change"
    report = await inspect_permissions(manager, "a")
    assert report["rows"][0]["status"] == "drift"
    assert "display_name" in report["rows"][0]["differences"]
    assert not device.writes and manager.repository.snapshot() == before
    assert "123456" not in str(report) and "000011112222" not in str(report)


async def test_unmanaged_inventory_is_not_implicitly_adopted(audit_fleet):
    manager, device, _driver, _user = audit_fleet
    device.users["777"] = {**deepcopy(PERSON), "employeeNo": "777", "name": "Unmanaged"}
    report = await inspect_permissions(manager, "a")
    assert report["counts"]["unmanaged"] == 1
    assert report["rows"][-1]["user_id"] is None and not device.writes


async def test_change_during_read_invalidates_report(audit_fleet):
    manager, device, driver, user = audit_fleet
    original = driver.async_inventory

    async def changed():
        await manager.repository.async_update(
            user.id, {"display_name": "New desired"}, expected_revision=1
        )
        return await original()

    driver.async_inventory = changed
    with pytest.raises(AccessError, match="review_stale"):
        await inspect_permissions(manager, "a")
    assert not device.writes


async def test_unloaded_station_cannot_supply_a_late_report(audit_fleet):
    manager, device, driver, _user = audit_fleet
    original = driver.async_inventory

    async def changed():
        manager.stations["a"].driver = None
        return await original()

    driver.async_inventory = changed
    with pytest.raises(AccessError, match="review_stale"):
        await inspect_permissions(manager, "a")
    assert not device.writes
