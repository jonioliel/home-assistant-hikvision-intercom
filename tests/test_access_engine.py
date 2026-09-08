"""Desired-state behavior against a stateful in-memory ISAPI device."""

import asyncio
import json
from copy import deepcopy
from dataclasses import replace
from unittest.mock import AsyncMock

import httpx
import pytest
from test_access_client import CARD_CAP, PERSON, USER_CAP

from custom_components.hikvision_intercom.access.engine import SyncEngine
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.client.access import AccessCapabilities, AccessClient
from custom_components.hikvision_intercom.client.client import ConnectionSettings, HikvisionClient
from custom_components.hikvision_intercom.exceptions import HikvisionConnectionError

CAP = AccessCapabilities.from_payloads(USER_CAP, CARD_CAP, {"pwMgrMode": "local"})


class Device:
    def __init__(self):
        self.users = {}
        self.cards = {}
        self.writes = []
        self.offline = False
        self.fail_after = None
        self.on_write = None

    async def handle(self, request):
        if self.offline:
            raise httpx.ConnectError("offline")
        path = request.url.path
        data = json.loads(request.content) if request.content else {}
        kind = "UserInfo" if "/UserInfo/" in path else "CardInfo"
        storage = self.users if kind == "UserInfo" else self.cards
        if path.endswith("/Search"):
            condition = data[kind + "SearchCond"]
            selected = condition.get("EmployeeNoList")
            rows = list(storage.values())
            if selected:
                rows = [row for row in rows if row["employeeNo"] == selected[0]["employeeNo"]]
            total = len(rows)
            position = condition["searchResultPosition"]
            page = rows[position : position + condition["maxResults"]]
            return httpx.Response(
                200,
                json={
                    kind + "Search": {
                        "searchID": condition["searchID"],
                        "responseStatusStrg": "MORE" if position + len(page) < total else "OK",
                        "numOfMatches": len(page),
                        "totalMatches": total,
                        kind: deepcopy(page),
                    }
                },
            )
        operation = path.rsplit("/", 1)[-1]
        self.writes.append((kind, operation, deepcopy(data)))
        if operation in {"Record", "Modify"}:
            item = deepcopy(data[kind])
            key = item["employeeNo"] if kind == "UserInfo" else item["cardNo"]
            if operation == "Record" and key in storage:
                return httpx.Response(
                    200,
                    json={
                        "statusCode": 6,
                        "subStatusCode": "employeeNoAlreadyExist"
                        if kind == "UserInfo"
                        else "cardNoAlreadyExist",
                    },
                )
            storage[key] = {**storage.get(key, {}), **item}
        elif operation == "Delete":
            condition = data[kind + "DelCond"]
            target = (
                condition["EmployeeNoList"][0]["employeeNo"]
                if kind == "UserInfo"
                else condition["CardNoList"][0]["cardNo"]
            )
            storage.pop(target, None)
        else:
            raise AssertionError("Unexpected endpoint")
        if self.on_write:
            await self.on_write()
        if self.fail_after == (kind, operation):
            self.fail_after = None
            raise httpx.ReadTimeout("ack lost")
        return httpx.Response(200, json={"statusCode": 1, "statusString": "OK"})


@pytest.fixture
async def setup():
    repository = AccessRepository(AsyncMock())
    await repository.async_load(None)
    device = Device()
    async with httpx.AsyncClient(transport=httpx.MockTransport(device.handle)) as session:
        driver = AccessClient(
            HikvisionClient(
                session,
                ConnectionSettings("192.0.2.10", "demo", "demo-secret"),
                enabled_doors=frozenset({1}),
            )
        )
        driver.capabilities = CAP
        yield repository, device, driver, SyncEngine(repository)


async def create_user(repo, **updates):
    return await repo.async_create(
        {
            "employee_no": "1001",
            "display_name": "Demo",
            "pin": "123456",
            "cards": [{"card_no": "000011112222"}],
            "assignments": {"a": {"allowed_locks": [1]}},
            **updates,
        }
    )


async def test_create_readback_and_repeat_are_idempotent(setup):
    repo, device, driver, engine = setup
    device.users["7"] = {**deepcopy(PERSON), "employeeNo": "7", "name": "Unmanaged"}
    original = deepcopy(device.users["7"])
    user = await create_user(repo)
    result = await engine.async_reconcile("a", driver)
    assert result.completed == 1 and result.failed == 0
    assert device.users["1001"]["localPassword"] == "123456"
    assert repo.get(user.id).assignments["a"].applied_revision == 1
    assert len(device.writes) == 2
    await engine.async_reconcile("a", driver)
    assert len(device.writes) == 2
    assert device.users["7"] == original


async def test_existing_unmanaged_employee_is_never_overwritten(setup):
    repo, device, driver, engine = setup
    user = await create_user(repo)
    device.users["1001"] = {**deepcopy(PERSON), "name": "Someone else"}
    result = await engine.async_reconcile("a", driver)
    assert result.failed == 1 and not device.writes
    assert repo.get(user.id).assignments["a"].last_error == "unmanaged_employee"


async def test_manual_change_becomes_conflict(setup):
    repo, device, driver, engine = setup
    user = await create_user(repo)
    await engine.async_reconcile("a", driver)
    device.writes.clear()
    device.users["1001"]["name"] = "Changed at device"
    result = await engine.async_reconcile("a", driver)
    assert result.failed == 1 and not device.writes
    assert repo.get(user.id).assignments["a"].sync_state == "conflict"


async def test_central_card_label_edit_requires_no_device_write(setup):
    repo, device, driver, engine = setup
    user = await create_user(repo)
    await engine.async_reconcile("a", driver)
    device.writes.clear()
    await repo.async_update(
        user.id,
        {"cards": [{"id": user.cards[0].id, "label": "Renamed label"}]},
        expected_revision=1,
    )
    await engine.async_reconcile("a", driver)
    assert not device.writes
    assert repo.get(user.id).assignments["a"].applied_revision == 2


async def test_lost_create_ack_recovers_by_readback_without_duplicate(setup):
    repo, device, driver, engine = setup
    user = await create_user(repo)
    device.fail_after = ("UserInfo", "Record")
    result = await engine.async_reconcile("a", driver)
    assert result.offline and repo.snapshot()["bindings"]["a"][user.id]["intent"]
    recovered = AccessRepository(AsyncMock())
    await recovered.async_load(repo.snapshot())
    result = await SyncEngine(recovered).async_reconcile("a", driver)
    assert result.completed == 1
    assert sum(item[:2] == ("UserInfo", "Record") for item in device.writes) == 1
    assert recovered.get(user.id).assignments["a"].sync_state == "synced"


async def test_new_revision_during_write_is_not_lost(setup):
    repo, device, driver, engine = setup
    user = await create_user(repo)

    async def edit():
        device.on_write = None
        await repo.async_update(user.id, {"display_name": "Latest"}, expected_revision=1)

    device.on_write = edit
    result = await engine.async_reconcile("a", driver)
    assert result.retry
    assert repo.get(user.id).assignments["a"].applied_revision is None
    await engine.async_reconcile("a", driver)
    assert device.users["1001"]["name"] == "Latest"
    assert repo.get(user.id).assignments["a"].applied_revision == 2


async def test_offline_delete_tombstone_survives_until_absence(setup):
    repo, device, driver, engine = setup
    user = await create_user(repo)
    await engine.async_reconcile("a", driver)
    await repo.async_delete(user.id, expected_revision=1)
    device.offline = True
    with pytest.raises(HikvisionConnectionError):
        await engine.async_reconcile("a", driver)
    assert user.id in repo.snapshot()["tombstones"]
    device.offline = False
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    await SyncEngine(restored).async_reconcile("a", driver)
    assert not device.users and not device.cards
    assert not restored.snapshot()["tombstones"]
    assert "123456" not in str(restored.snapshot())


async def test_revoke_then_reenable_same_canonical_identity(setup):
    repo, device, driver, engine = setup
    user = await create_user(repo)
    await engine.async_reconcile("a", driver)
    await repo.async_update(user.id, {"active": False}, expected_revision=1)
    await engine.async_reconcile("a", driver)
    assert not device.users and repo.get(user.id).identity_locked
    await repo.async_update(user.id, {"active": True}, expected_revision=2)
    await engine.async_reconcile("a", driver)
    assert list(device.users) == ["1001"] and list(device.cards) == ["000011112222"]


async def test_card_replacement_at_capacity_removes_before_add(setup):
    repo, device, driver, engine = setup
    driver.capabilities = replace(CAP, max_cards=1, cards_per_person=1)
    user = await create_user(repo)
    await engine.async_reconcile("a", driver)
    device.writes.clear()
    await repo.async_update(user.id, {"cards": [{"card_no": "000099998888"}]}, expected_revision=1)
    await engine.async_reconcile("a", driver)
    assert [(kind, operation) for kind, operation, _ in device.writes] == [
        ("CardInfo", "Delete"),
        ("CardInfo", "Record"),
    ]
    assert list(device.cards) == ["000099998888"]
    assert not repo.snapshot()["retired_cards"]


async def test_other_person_card_conflict_is_detected_before_create(setup):
    repo, device, driver, engine = setup
    user = await create_user(repo)
    device.users["7"] = {**deepcopy(PERSON), "employeeNo": "7"}
    device.cards["000011112222"] = {
        "employeeNo": "7",
        "cardNo": "000011112222",
        "cardType": "normalCard",
    }
    await engine.async_reconcile("a", driver)
    assert not device.writes
    assert repo.get(user.id).assignments["a"].last_error == "card_owned_elsewhere"


async def test_two_reconciliations_share_station_lock(setup):
    repo, device, driver, engine = setup
    await create_user(repo)
    results = await asyncio.gather(
        engine.async_reconcile("a", driver), engine.async_reconcile("a", driver)
    )
    assert all(result.completed == 1 for result in results)
    assert len(device.writes) == 2


async def test_persisted_intent_recovers_from_store_failure_after_write(setup):
    repo, device, driver, engine = setup
    user = await create_user(repo, cards=[])
    saved = repo.snapshot()
    fail = False

    async def save(data):
        nonlocal saved
        if fail:
            raise OSError("disk failure")
        saved = deepcopy(data)

    repo._save = save

    async def fail_store():
        nonlocal fail
        fail = True
        device.on_write = None

    device.on_write = fail_store
    with pytest.raises(OSError):
        await engine.async_reconcile("a", driver)
    assert len(device.writes) == 1
    restored = AccessRepository(AsyncMock())
    await restored.async_load(saved)
    await SyncEngine(restored).async_reconcile("a", driver)
    assert len(device.writes) == 1
    assert restored.get(user.id).assignments["a"].sync_state == "synced"
