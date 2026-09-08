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


async def test_eight_online_stations_progress_with_one_offline_and_max_three_writers():
    from contextlib import asynccontextmanager

    import httpx
    from test_access_engine import CAP, Device

    from custom_components.hikvision_intercom.client.access import AccessClient
    from custom_components.hikvision_intercom.client.client import (
        ConnectionSettings,
        HikvisionClient,
    )

    repo = AccessRepository(AsyncMock())
    await repo.async_load(None)
    manager = AccessManager(repo)
    sessions, devices = [], []
    active = maximum = 0
    three = asyncio.Event()

    def instrument(driver):
        original = driver.transaction

        @asynccontextmanager
        async def transaction():
            nonlocal active, maximum
            async with original():
                active += 1
                maximum = max(active, maximum)
                if active == 3:
                    three.set()
                try:
                    await three.wait()
                    yield
                finally:
                    active -= 1

        driver.transaction = transaction

    try:
        for number in range(9):
            device = Device()
            device.offline = number == 0
            session = httpx.AsyncClient(transport=httpx.MockTransport(device.handle))
            sessions.append(session)
            devices.append(device)
            driver = AccessClient(
                HikvisionClient(
                    session,
                    ConnectionSettings("192.0.2.10", "demo", "secret"),
                    enabled_doors=frozenset({1}),
                )
            )
            driver.capabilities = CAP
            driver.async_capabilities = AsyncMock(return_value=CAP)
            instrument(driver)
            manager.register(str(number), "Station", True)
            manager.attach(str(number), driver)
        user = await manager.async_create(
            {
                "display_name": "Resident",
                "assignments": {str(number): {"allowed_locks": [1]} for number in range(9)},
            }
        )
        async with asyncio.timeout(5):
            await drain(manager)
        assert maximum == 3
        assert manager.repository.get(user["id"]).assignments["0"].sync_state == "offline"
        assert all(len(device.users) == 1 for device in devices[1:])
    finally:
        await manager.async_close()
        await asyncio.gather(*(session.aclose() for session in sessions))


async def test_deletion_conflict_requires_review_before_continuing(fleet):
    manager, device, _driver = fleet
    user = await manager.async_create(
        {
            "employee_no": "1001",
            "display_name": "Resident",
            "assignments": {"a": {"allowed_locks": [1]}},
        }
    )
    await drain(manager)
    device.users["1001"]["name"] = "Manual change"
    await manager.async_delete(user["id"], revision=1)
    await drain(manager)
    assert (
        device.users
        and manager.public()["tombstones"][0]["stations"]["a"]["sync_state"] == "conflict"
    )
    review = await manager.async_review("a", user["id"])
    assert review["deletion_pending"] and review["display_name"] == "Manual change"
    await manager.async_resolve_deletion("a", user["id"], review_token=review["review_token"])
    await drain(manager)
    assert not device.users and not manager.public()["tombstones"]


async def test_deleted_device_record_can_be_explicitly_recreated(fleet):
    manager, device, _driver = fleet
    user = await manager.async_create(
        {
            "employee_no": "1001",
            "display_name": "Resident",
            "assignments": {"a": {"allowed_locks": [1]}},
        }
    )
    await drain(manager)
    del device.users["1001"]
    manager.request("a")
    await drain(manager)
    assert manager.repository.get(user["id"]).assignments["a"].sync_state == "conflict"
    review = await manager.async_review("a", user["id"])
    assert review["absent"]
    await manager.async_resolve(
        "a", user["id"], review_token=review["review_token"], revision=1, direction="central"
    )
    await drain(manager)
    assert device.users["1001"]["name"] == "Resident"


async def test_fleet_health_counts_pending_people_once_and_survives_restart(fleet):
    manager, device, _ = fleet
    created = await manager.async_create(
        {
            "display_name": "Resident",
            "pin": "918273",
            "cards": [{"card_no": "000011112222"}],
            "assignments": {"a": {"allowed_locks": [1]}},
        }
    )
    await drain(manager)
    station = manager.public()["stations"][0]
    assert station["managed_user_count"] == 1 and station["pending_user_count"] == 0
    reconciled = station["reconciled_at"]
    assert reconciled
    device.offline = True
    updated = await manager.async_update(created["id"], {"pin": "827364", "cards": []}, revision=1)
    await drain(manager)
    public = manager.public()
    assert public["stations"][0]["pending_user_count"] == 1
    assert public["stations"][0]["reconciled_at"] == reconciled
    assert len(public["card_removals"]) == len(public["pin_removals"]) == 1
    for secret in ("918273", "827364", "000011112222"):
        assert secret not in str(public)

    async def save(_data):
        pass

    restarted = AccessRepository(save)
    await restarted.async_load(manager.repository.snapshot())
    restored = AccessManager(restarted)
    restored.register("a", "Front", True)
    assert restored.public()["stations"][0]["pending_user_count"] == 1
    assert restored.public()["stations"][0]["reconciled_at"] is None
    assert len(restored.public()["pin_removals"]) == 1
    await restored.async_close()

    await manager.async_delete(created["id"], revision=updated["revision"])
    await drain(manager)
    assert manager.public()["stations"][0]["pending_user_count"] == 1
    assert manager.public()["tombstones"]
    device.offline = False
    manager.request("a")
    await drain(manager)
    station = manager.public()["stations"][0]
    assert station["pending_user_count"] == station["managed_user_count"] == 0
    assert not manager.public()["pin_removals"]
    assert not manager.public()["card_removals"]


async def test_health_includes_assignment_revocation_without_a_matrix_cell(fleet):
    manager, device, _ = fleet
    user = await manager.async_create(
        {
            "display_name": "Resident",
            "assignments": {"a": {"allowed_locks": [1]}},
        }
    )
    await drain(manager)
    device.offline = True
    await manager.async_update(user["id"], {"assignments": {}}, revision=1)
    await drain(manager)
    public = manager.public()
    assert public["users"][0]["assignments"] == {}
    assert public["stations"][0]["pending_user_count"] == 1
    assert len(public["revocations"]) == 1
    device.offline = False
    manager.request("a")
    await drain(manager)
    assert manager.public()["stations"][0]["pending_user_count"] == 0
    assert not device.users and not manager.public()["revocations"]


async def test_rescan_reads_inventory_without_queueing_pending_access_writes(fleet):
    manager, device, _ = fleet
    user = await manager.repository.async_create(
        {
            "display_name": "Pending person",
            "pin": "918273",
            "assignments": {"a": {"allowed_locks": [1]}},
        }
    )
    reconciled = manager.stations["a"].reconciled_at
    device.users["1001"] = deepcopy(PERSON)
    before = manager.repository.snapshot()
    await manager.async_rescan("a")
    station = manager.public()["stations"][0]
    assert station["user_count"] == station["unmanaged_count"] == 1
    assert station["pending_user_count"] == 1
    assert station["reconciled_at"] == reconciled
    assert manager.repository.snapshot() == before
    assert device.writes == [] and manager.stations["a"].task is None
    assert not manager.stations["a"].pending
    manager.request("a")
    await drain(manager)
    assert manager.repository.get(user.id).assignments["a"].sync_state == "synced"
    assert device.writes


async def test_simultaneous_rescans_share_reads_and_one_cancelled_waiter_is_isolated(fleet):
    manager, _device, driver = fleet
    original = driver.async_inventory
    entered, release = asyncio.Event(), asyncio.Event()

    async def read():
        entered.set()
        await release.wait()
        return await original()

    driver.async_inventory = AsyncMock(side_effect=read)
    first = asyncio.create_task(manager.async_rescan("a"))
    await entered.wait()
    second = asyncio.create_task(manager.async_rescan("a"))
    await asyncio.sleep(0)
    assert manager.public()["stations"][0]["scanning"]
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    assert not manager.stations["a"].scan_task.cancelled()
    release.set()
    await second
    assert driver.async_inventory.await_count == 1
    assert not manager.public()["stations"][0]["scanning"]


async def test_detach_cancels_shared_scan_and_does_not_publish_stale_inventory(fleet):
    manager, _device, driver = fleet
    entered = asyncio.Event()

    async def read():
        entered.set()
        await asyncio.Event().wait()

    driver.async_inventory = AsyncMock(side_effect=read)
    request = asyncio.create_task(manager.async_rescan("a"))
    await entered.wait()
    task = manager.stations["a"].scan_task
    await manager.async_detach("a")
    with pytest.raises(asyncio.CancelledError):
        await request
    assert task.cancelled()
    assert manager.stations["a"].scan_task is None
    assert manager.stations["a"].inventory is None
    with pytest.raises(AccessError, match="station_offline"):
        await manager.async_rescan("a")


async def test_post_write_scan_cannot_reuse_an_earlier_inventory_snapshot(fleet):
    manager, device, driver = fleet
    original = driver.async_inventory
    entered, release = asyncio.Event(), asyncio.Event()
    first = True

    async def read():
        nonlocal first
        snapshot = await original()
        if first:
            first = False
            entered.set()
            await release.wait()
        return snapshot

    driver.async_inventory = AsyncMock(side_effect=read)
    old = asyncio.create_task(manager.async_rescan("a"))
    await entered.wait()
    device.users["1001"] = deepcopy(PERSON)  # Simulate a write after the first snapshot.
    fresh = asyncio.create_task(manager._scan(manager.stations["a"], fresh=True))
    await asyncio.sleep(0)
    release.set()
    await asyncio.gather(old, fresh)
    assert driver.async_inventory.await_count == 2
    assert "1001" in manager.stations["a"].inventory.users


async def test_rescan_failure_is_private_and_does_not_destroy_previous_observation(fleet, caplog):
    manager, _device, driver = fleet
    previous = manager.stations["a"].scanned_at
    driver.async_inventory = AsyncMock(side_effect=RuntimeError("PRIVATE-PIN-918273"))
    with pytest.raises(AccessError, match="storage_or_internal_error"):
        await manager.async_rescan("a")
    station = manager.public()["stations"][0]
    assert station["scan_error"] == "storage_or_internal_error"
    assert station["scanned_at"] == previous and not station["scanning"]
    assert "PRIVATE-PIN-918273" not in caplog.text + str(manager.public())
