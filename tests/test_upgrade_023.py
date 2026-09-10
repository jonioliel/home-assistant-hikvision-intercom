"""Frozen 0.23 data must resume credentials, deletions and receipts without re-import."""

import asyncio
import json
from copy import deepcopy
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest
from test_access_engine import CAP, Device

from custom_components.hikvision_intercom.access.engine import SyncEngine
from custom_components.hikvision_intercom.access.manager import AccessManager
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.client.access import AccessClient
from custom_components.hikvision_intercom.client.client import ConnectionSettings, HikvisionClient
from custom_components.hikvision_intercom.exceptions import HikvisionConnectionError

FIXTURE = Path(__file__).parent / "fixtures/upgrade_023/pending.json"


def upgrade_fixture():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


async def test_upgrade_023_preserves_data_and_resets_interrupted_writes():
    fixture = upgrade_fixture()
    data = fixture["store"]["data"]
    repo = AccessRepository(AsyncMock())
    await repo.async_load(data)
    expected = deepcopy(data)
    expected["schema"] = 4
    for record in expected["users"].values():
        record.update(profile={}, group_ids=[], photo=None)
    for user in expected["users"].values():
        for assignment in user["assignments"].values():
            if assignment["sync_state"] == "syncing":
                assignment["sync_state"] = "pending"
    for bindings in expected["bindings"].values():
        for binding in bindings.values():
            if binding.get("sync_state") == "syncing":
                binding["sync_state"] = "pending"
    for tombstone in expected["tombstones"].values():
        for station in tombstone.get("stations", {}).values():
            if station.get("sync_state") == "syncing":
                station["sync_state"] = "pending"
    assert repo.snapshot() == expected
    assert fixture == upgrade_fixture(), "Loading cannot modify the source backup"
    assert repo.get(fixture["expected"]["resident"]).pin.value == "654322"
    assert "654322" not in str(repo.public())
    assert not repo.get(fixture["expected"]["inactive"]).active


async def test_upgrade_023_reconciles_offline_removals_without_duplicate_or_unmanaged_writes():
    fixture = upgrade_fixture()
    repo = AccessRepository(AsyncMock())
    await repo.async_load(fixture["store"]["data"])
    manager = AccessManager(repo)
    devices, sessions, drivers = {}, {}, {}
    for sid, saved in fixture["devices"].items():
        device = Device()
        device.users, device.cards = deepcopy(saved["users"]), deepcopy(saved["cards"])
        devices[sid] = device
        sessions[sid] = httpx.AsyncClient(transport=httpx.MockTransport(device.handle))
        driver = AccessClient(
            HikvisionClient(
                sessions[sid],
                ConnectionSettings("192.0.2.10", "demo", "fixture-secret"),
                enabled_doors=frozenset({1}),
            )
        )
        driver.capabilities = CAP
        drivers[sid] = driver
        manager.register(sid, "Fixture " + sid, True)
    try:
        receipt = fixture["expected"]["receipt"]
        assert await manager.bulk.apply("fixture-admin", receipt["operation_id"]) == receipt
        with pytest.raises(AccessError, match="pin_removal_pending"):
            await repo.async_create({"display_name": "New", "pin": "654321"})
        engine = SyncEngine(repo)
        assert (await engine.async_reconcile("a", drivers["a"])).failed == 0
        assert not devices["a"].writes
        devices["b"].offline = True
        with pytest.raises(HikvisionConnectionError):
            await engine.async_reconcile("b", drivers["b"])
        assert repo.snapshot()["tombstones"] and repo.snapshot()["retired_pins"]
        devices["b"].offline = False
        result = await engine.async_reconcile("b", drivers["b"])
        assert result.failed == 0
        final = repo.snapshot()
        assert not final["tombstones"] and not final["retired_pins"] and not final["retired_cards"]
        assert final["operation_receipts"] == fixture["store"]["data"]["operation_receipts"]
        assert final["admin_audit"] == fixture["store"]["data"]["admin_audit"]
        for sid, device in devices.items():
            assert device.users["1001"]["localPassword"] == "654322"
            assert "1002" not in device.users and not device.cards
            assert device.users["9999"] == fixture["devices"][sid]["users"]["9999"]
        writes = len(devices["b"].writes)
        await engine.async_reconcile("b", drivers["b"])
        assert len(devices["b"].writes) == writes
        assert (
            await repo.async_create({"display_name": "New", "pin": "654321"})
        ).pin.value == "654321"
    finally:
        await manager.async_close()
        await asyncio.gather(*(session.aclose() for session in sessions.values()))
