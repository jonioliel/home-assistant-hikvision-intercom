"""Fleet operations against stateful device I/O; no live equipment is mutated."""

import asyncio
from copy import deepcopy
from unittest.mock import AsyncMock

import pytest
from test_access_client import PERSON
from test_access_engine import setup as setup  # noqa: F401

from custom_components.hikvision_intercom.access.manager import AccessManager
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.repository import AccessRepository


async def drain(manager):
    while tasks := [station.task for station in manager.stations.values() if station.task]:
        await asyncio.gather(*tasks)


@pytest.fixture
async def fleet(setup):
    repo, device, driver, _engine = setup
    driver.async_capabilities = AsyncMock(return_value=driver.capabilities)
    manager = AccessManager(repo)
    manager.register("a", "Front", True)
    manager.attach("a", driver)
    await drain(manager)
    yield manager, device, driver
    await manager.async_close()


async def test_first_scan_leaves_all_existing_users_unmanaged(fleet):
    manager, device, _ = fleet
    device.users["1001"] = deepcopy(PERSON)
    manager.request("a")
    await drain(manager)
    station = manager.public()["stations"][0]
    assert station["unmanaged_count"] == 1
    assert manager.repository.users() == [] and device.writes == []


async def test_create_and_background_sync(fleet):
    manager, device, _ = fleet
    user = await manager.async_create(
        {"display_name": "Resident", "pin": "918273", "assignments": {"a": {"allowed_locks": [1]}}}
    )
    await drain(manager)
    current = manager.repository.get(user["id"])
    assert current.assignments["a"].sync_state == "synced"
    assert device.users[current.employee_no]["localPassword"] == "918273"
    public = str(manager.public())
    assert "918273" not in public and "fingerprint_key" not in public
    assert manager.has_access("a")


@pytest.mark.parametrize(
    "data,code",
    [
        ({"assignments": {"missing": {"allowed_locks": [1]}}}, "station_not_found"),
        ({"pin": "12", "assignments": {"a": {"allowed_locks": [1]}}}, "pin_exceeds_capabilities"),
        ({"assignments": {"camera": {"allowed_locks": [1]}}}, "station_has_no_managed_lock"),
    ],
)
async def test_invalid_assignment_or_credential_not_saved(fleet, data, code):
    manager, device, _ = fleet
    manager.register("camera", "Camera", False)
    with pytest.raises(AccessError, match=code):
        await manager.async_create({"display_name": "Resident", **data})
    assert not manager.repository.users() and not device.writes


async def test_offline_one_station_does_not_prevent_central_edits(fleet):
    manager, device, _ = fleet
    device.offline = True
    user = await manager.async_create(
        {"display_name": "Resident", "assignments": {"a": {"allowed_locks": [1]}}}
    )
    await drain(manager)
    assert manager.repository.get(user["id"]).assignments["a"].sync_state == "offline"
    assert manager.stations["a"].timer is not None
    device.offline = False
    manager.request("a")
    await drain(manager)
    assert manager.repository.get(user["id"]).assignments["a"].sync_state == "synced"


async def test_deletion_keeps_offline_tombstone_status(fleet):
    manager, device, _ = fleet
    user = await manager.async_create(
        {"display_name": "Resident", "assignments": {"a": {"allowed_locks": [1]}}}
    )
    await drain(manager)
    device.offline = True
    await manager.async_delete(user["id"], revision=user["revision"])
    await drain(manager)
    tombstone = manager.public()["tombstones"][0]
    assert tombstone["stations"]["a"]["sync_state"] == "offline"
    device.offline = False
    manager.request("a")
    await drain(manager)
    assert not manager.public()["tombstones"] and not device.users
    assert not manager.has_access("a")


async def test_adopt_preserves_exact_card_and_never_returns_pin(fleet):
    manager, device, _ = fleet
    device.users["1001"] = {**deepcopy(PERSON), "localPassword": "987654"}
    device.cards["000011112222"] = {
        "employeeNo": "1001",
        "cardNo": "000011112222",
        "cardType": "normalCard",
    }
    preview = (await manager.async_inventory("a"))[0]
    assert "000011112222" not in str(preview) and "987654" not in str(preview)
    user = await manager.async_adopt("a", "1001", review_token=preview["review_token"])
    await drain(manager)
    assert user["employee_no"] == "1001" and user["identity_locked"]
    assert manager.repository.get(user["id"]).cards[0].card_no.value == "000011112222"
    assert device.writes == []


async def test_adopt_requires_unchanged_review(fleet):
    manager, device, _ = fleet
    device.users["1001"] = deepcopy(PERSON)
    preview = (await manager.async_inventory("a"))[0]
    device.users["1001"]["name"] = "Changed outside HA"
    with pytest.raises(AccessError, match="review_stale"):
        await manager.async_adopt("a", "1001", review_token=preview["review_token"])
    assert manager.repository.users() == [] and device.writes == []


@pytest.mark.parametrize("direction", ["central", "device"])
async def test_explicit_conflict_resolution(fleet, direction):
    manager, device, _ = fleet
    user = await manager.async_create(
        {
            "employee_no": "1001",
            "display_name": "Central name",
            "assignments": {"a": {"allowed_locks": [1]}},
        }
    )
    await drain(manager)
    device.users["1001"]["name"] = "Device name"
    manager.request("a")
    await drain(manager)
    assert manager.repository.get(user["id"]).assignments["a"].sync_state == "conflict"
    preview = (await manager.async_inventory("a"))[0]
    await manager.async_resolve(
        "a", user["id"], review_token=preview["review_token"], revision=1, direction=direction
    )
    await drain(manager)
    expected = "Central name" if direction == "central" else "Device name"
    assert device.users["1001"]["name"] == expected
    assert manager.repository.get(user["id"]).display_name == expected


async def test_ignore_is_local_only(fleet):
    manager, device, _ = fleet
    device.users["1001"] = deepcopy(PERSON)
    await manager.async_inventory("a")
    await manager.async_ignore("a", "1001", ignored=True)
    assert manager.public()["stations"][0]["unmanaged_count"] == 0
    assert (await manager.async_inventory("a"))[0]["ignored"]
    assert not device.writes


async def test_targeted_unmanaged_delete_is_journaled_and_verified(fleet):
    manager, device, _ = fleet
    device.users["1001"] = deepcopy(PERSON)
    device.users["2002"] = {**deepcopy(PERSON), "employeeNo": "2002"}
    preview = (await manager.async_inventory("a"))[0]
    await manager.async_adopt("a", "1001", review_token=preview["review_token"], delete=True)
    await drain(manager)
    assert set(device.users) == {"2002"}
    assert not manager.repository.users() and not manager.public()["tombstones"]
    assert device.writes[0][2]["UserInfoDelCond"]["EmployeeNoList"] == [{"employeeNo": "1001"}]


async def test_removed_assignment_has_visible_revocation_until_verified(fleet):
    manager, device, _ = fleet
    user = await manager.async_create(
        {"display_name": "Resident", "assignments": {"a": {"allowed_locks": [1]}}}
    )
    await drain(manager)
    device.offline = True
    await manager.async_update(user["id"], {"assignments": {}}, revision=1)
    await drain(manager)
    assert manager.public()["revocations"][0]["sync_state"] == "offline"
    device.offline = False
    manager.request("a")
    await drain(manager)
    assert not manager.public()["revocations"] and not device.users


async def test_detach_cancels_waiting_io_and_retry_timer(fleet):
    manager, _device, driver = fleet
    started = asyncio.Event()

    async def stuck():
        started.set()
        await asyncio.Event().wait()

    driver.async_inventory = stuck
    manager.request("a")
    await started.wait()
    await manager.async_detach("a")
    station = manager.stations["a"]
    assert station.driver is None and station.task is None and station.timer is None


async def test_cancellation_waits_for_durable_save_before_next_edit():
    repo = AccessRepository(AsyncMock())
    await repo.async_load(None)
    started, finish = asyncio.Event(), asyncio.Event()
    writes = []

    async def saving(data):
        started.set()
        await finish.wait()
        writes.append(data)

    repo._save = saving
    task = asyncio.create_task(repo.async_create({"display_name": "Resident"}))
    await started.wait()
    task.cancel()
    await asyncio.sleep(0)
    assert not task.done()
    finish.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(repo.users()) == 1 and len(writes) == 1
