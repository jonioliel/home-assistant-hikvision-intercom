"""Capabilities, pagination completeness and bounded credential mutations."""

import asyncio
import json
from copy import deepcopy
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest

from custom_components.hikvision_intercom.client.access import (
    AccessCapabilities,
    AccessClient,
    validate_card,
    validate_identifier,
)
from custom_components.hikvision_intercom.client.client import ConnectionSettings, HikvisionClient
from custom_components.hikvision_intercom.exceptions import (
    HikvisionDeviceError,
    HikvisionValidationError,
)

FIXTURES = Path(__file__).parent / "fixtures/ds_kv6124_e1_fw_3_9_0"
USER_CAP = json.loads((FIXTURES / "user_capabilities.json").read_text())["payload"]
CARD_CAP = json.loads((FIXTURES / "card_capabilities.json").read_text())["payload"]
CAP = AccessCapabilities.from_payloads(USER_CAP, CARD_CAP, {"pwMgrMode": "local"})
SETTINGS = ConnectionSettings("192.0.2.10", "demo", "demo-secret")
PERSON = {
    "employeeNo": "1001",
    "name": "Demo",
    "userType": "normal",
    "Valid": {
        "enable": False,
        "beginTime": "1970-01-01T00:00:00",
        "endTime": "2037-12-31T23:59:59",
        "timeType": "local",
    },
    "doorRight": "1",
    "RightPlan": [],
    "localUIRight": False,
}


def test_real_capabilities_select_pin_field_and_limits():
    assert (CAP.pin_field, CAP.pin_min, CAP.pin_max, CAP.cards_per_person) == (
        "localPassword",
        4,
        8,
        5,
    )
    assert CAP.max_users == 2000 and CAP.max_cards == 6000
    assert (
        AccessCapabilities.from_payloads(USER_CAP, CARD_CAP, {"pwMgrMode": "platform"}).pin_field
        == "password"
    )
    unknown = AccessCapabilities.from_payloads(USER_CAP, CARD_CAP, {"pwMgrMode": []})
    assert unknown.pin_field is None and unknown.pin_mode == "unknown"


@pytest.mark.parametrize("value", [None, "", True, " ", "1,2", "1/2", "<xml>", "x" * 33])
def test_selector_validation_rejects_bulk_and_injected_targets(value):
    for validate in (validate_identifier, validate_card):
        with pytest.raises(HikvisionValidationError):
            validate(value)


async def test_complete_paginated_inventory():
    pages = []
    people = [{"employeeNo": str(i), "name": "Demo"} for i in range(1001, 1033)]

    def handler(request):
        data = json.loads(request.content)
        kind = "UserInfo" if "UserInfo" in request.url.path else "CardInfo"
        condition = data[kind + "SearchCond"]
        offset = condition["searchResultPosition"]
        rows = people[offset : offset + 30] if kind == "UserInfo" else []
        pages.append((kind, offset))
        total = len(people) if kind == "UserInfo" else 0
        return httpx.Response(
            200,
            json={
                kind + "Search": {
                    "searchID": condition["searchID"],
                    "responseStatusStrg": "MORE" if offset + len(rows) < total else "OK",
                    "numOfMatches": len(rows),
                    "totalMatches": total,
                    kind: rows,
                }
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        driver = AccessClient(HikvisionClient(session, SETTINGS))
        driver.capabilities = CAP
        inventory = await driver.async_inventory()
    assert len(inventory.users) == 32 and not inventory.cards
    assert pages == [("UserInfo", 0), ("UserInfo", 30), ("CardInfo", 0)]
    assert "1001" not in repr(inventory)


@pytest.mark.parametrize(
    "broken",
    [
        "ignored_filter",
        "incomplete_ok",
        "duplicate",
        "unknown_status",
        "wrong_count",
        "wrong_search_id",
        "no_progress",
        "false_no_match",
    ],
)
async def test_malformed_inventory_is_not_reconciled(broken):
    def handler(request):
        condition = json.loads(request.content)["UserInfoSearchCond"]
        result = {
            "searchID": condition["searchID"],
            "responseStatusStrg": "OK",
            "numOfMatches": 1,
            "totalMatches": 1,
            "UserInfo": [{"employeeNo": "1001"}],
        }
        if broken == "ignored_filter":
            result["UserInfo"][0]["employeeNo"] = "other"
        if broken == "incomplete_ok":
            result["totalMatches"] = 2
        if broken == "duplicate":
            result.update(
                UserInfo=[{"employeeNo": "1001"}, {"employeeNo": "1001"}],
                numOfMatches=2,
                totalMatches=2,
            )
        if broken == "unknown_status":
            result["responseStatusStrg"] = "future"
        if broken == "wrong_count":
            result["numOfMatches"] = 0
        if broken == "wrong_search_id":
            result["searchID"] = "other"
        if broken == "no_progress":
            result.update(UserInfo=[], numOfMatches=0, totalMatches=2, responseStatusStrg="MORE")
        if broken == "false_no_match":
            result["responseStatusStrg"] = "NO MATCH"
        return httpx.Response(200, json={"UserInfoSearch": result})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        driver = AccessClient(HikvisionClient(session, SETTINGS))
        driver.capabilities = CAP
        with pytest.raises(HikvisionValidationError):
            await driver.async_person("1001")


async def test_mutations_require_owned_transaction_and_selected_output():
    handler = AsyncMock(return_value=httpx.Response(200, json={"statusCode": 1}))
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        driver = AccessClient(HikvisionClient(session, SETTINGS))
        driver.capabilities = CAP
        with pytest.raises(HikvisionValidationError):
            await driver.async_delete_person("1001")
        async with driver.transaction():
            with pytest.raises(HikvisionValidationError):
                await driver.async_delete_card("00123456")
    handler.assert_not_called()


async def test_exact_card_and_person_selectors_json_and_single_attempt():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"statusCode": 1})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        driver = AccessClient(HikvisionClient(session, SETTINGS, enabled_doors=frozenset({1})))
        driver.capabilities = CAP
        async with driver.transaction():
            await driver.async_delete_card("00123456")
            await driver.async_delete_person("1001")
    assert len(requests) == 2
    assert all(item.headers["Content-Type"] == "application/json" for item in requests)
    assert json.loads(requests[0].content) == {
        "CardInfoDelCond": {"CardNoList": [{"cardNo": "00123456"}]}
    }
    assert json.loads(requests[1].content) == {
        "UserInfoDelCond": {"EmployeeNoList": [{"employeeNo": "1001"}]}
    }


@pytest.mark.parametrize(
    "change",
    [
        {"doorRight": "2"},
        {"doorRight": "1,2"},
        {"RightPlan": [{"doorNo": 1, "planTemplateNo": "65535"}]},
        {"localUIRight": True},
        {"password": "123456"},
        {"localPassword": "12"},
        {"localPassword": "abcd"},
        {"name": "x" * 33},
    ],
)
async def test_person_payload_cannot_expand_permissions(change):
    handler = AsyncMock(return_value=httpx.Response(200, json={"statusCode": 1}))
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        driver = AccessClient(HikvisionClient(session, SETTINGS, enabled_doors=frozenset({1})))
        driver.capabilities = CAP
        async with driver.transaction():
            with pytest.raises(HikvisionValidationError):
                await driver.async_write_person({**deepcopy(PERSON), **change}, create=True)
    handler.assert_not_called()


async def test_person_create_edit_and_pin_clear_use_mode_field():
    bodies = []

    def handler(request):
        bodies.append((request.method, request.url.path, json.loads(request.content)))
        return httpx.Response(200, json={"statusCode": 1})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        driver = AccessClient(HikvisionClient(session, SETTINGS, enabled_doors=frozenset({1})))
        driver.capabilities = CAP
        async with driver.transaction():
            await driver.async_write_person({**PERSON, "localPassword": "123456"}, create=True)
            await driver.async_write_person({**PERSON, "localPassword": ""}, create=False)
    assert bodies[0][0:2] == ("POST", "/ISAPI/AccessControl/UserInfo/Record")
    assert bodies[1][0:2] == ("PUT", "/ISAPI/AccessControl/UserInfo/Modify")
    assert bodies[1][2]["UserInfo"]["localPassword"] == ""


async def test_transaction_is_task_owned_and_releases_after_cancel():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"statusCode": 1}))
    ) as session:
        driver = AccessClient(HikvisionClient(session, SETTINGS, enabled_doors=frozenset({1})))
        driver.capabilities = CAP
        async with driver.transaction():
            with pytest.raises(HikvisionValidationError):
                await asyncio.create_task(driver.async_delete_person("1001"))
            with pytest.raises(HikvisionValidationError):
                async with driver.transaction():
                    pass
        assert driver._owner is None and not driver.client._write_lock.locked()


async def test_success_http_is_not_write_acknowledgement():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"result": "OK"}))
    ) as session:
        driver = AccessClient(HikvisionClient(session, SETTINGS, enabled_doors=frozenset({1})))
        driver.capabilities = CAP
        async with driver.transaction():
            with pytest.raises(HikvisionDeviceError):
                await driver.async_delete_person("1001")
