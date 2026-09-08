"""Regression coverage for real firmware validity rejection and private sync breadcrumbs."""

import asyncio
import json
import logging
from copy import deepcopy
from unittest.mock import AsyncMock

import pytest
from test_access_engine import setup as setup  # noqa: F401
from test_access_manager import drain  # noqa: F401
from test_access_manager import fleet as fleet

from custom_components.hikvision_intercom.access.diagnostics import SyncDiagnostics
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.normalize import canonical
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.client.access import StationInventory
from custom_components.hikvision_intercom.client.parser import check_response_status
from custom_components.hikvision_intercom.exceptions import HikvisionDeviceError


def rejected_dates():
    try:
        check_response_status(
            {
                "statusCode": 6,
                "subStatusCode": "badJsonContent",
                "errorCode": 1610612759,
                "errorMsg": "beginTime and endTime",
            }
        )
    except HikvisionDeviceError as error:
        return error
    raise AssertionError("Expected the device rejection")


async def test_date_rejection_visible_and_retry_recovers_saved_intent(fleet, caplog):
    manager, device, driver = fleet
    original = driver.async_write_person
    driver.async_write_person = AsyncMock(side_effect=rejected_dates())
    caplog.set_level(
        logging.DEBUG, logger="custom_components.hikvision_intercom.access.diagnostics"
    )
    user = await manager.async_create(
        {
            "display_name": "PRIVATE PERSON",
            "pin": "918273",
            "assignments": {"a": {"allowed_locks": [1]}},
        }
    )
    await drain(manager)
    assert manager.stations["a"].error == "validity_rejected"
    assert manager.repository.get(user["id"]).assignments["a"].last_error == "validity_rejected"
    report = manager.sync_diagnostics()
    failure = next(row for row in report["recent"] if row.get("error") == "validity_rejected")
    assert failure["step"] == "create_person"
    assert failure["fields"] == ["beginTime", "endTime"]
    assert failure["status_code"] == 6 and failure["sub_status"] == "badjsoncontent"
    assert "918273" not in json.dumps(report) + caplog.text
    assert "PRIVATE PERSON" not in json.dumps(report) + caplog.text
    assert user["id"] not in json.dumps(report) + caplog.text
    assert manager.repository.snapshot()["bindings"]["a"][user["id"]]["intent"]
    driver.async_write_person = original
    manager.request("a")
    await drain(manager)
    assert manager.repository.get(user["id"]).assignments["a"].sync_state == "synced"
    assert manager.stations["a"].error is None
    validity = device.users[user["employee_no"]]["Valid"]
    assert validity == {
        "enable": False,
        "beginTime": "2000-01-01T00:00:00+00:00",
        "endTime": "2030-01-01T00:00:00+00:00",
        "timeType": "UTC",
    }
    count = len(device.writes)
    manager.request("a")
    await drain(manager)
    assert len(device.writes) == count


async def test_permanent_firmware_time_label_does_not_block_readback(fleet):
    manager, device, _ = fleet

    async def firmware_response():
        for user in device.users.values():
            user["Valid"]["timeType"] = "local"

    device.on_write = firmware_response
    user = await manager.async_create(
        {"display_name": "Resident", "assignments": {"a": {"allowed_locks": [1]}}}
    )
    await drain(manager)
    assert manager.repository.get(user["id"]).assignments["a"].sync_state == "synced"
    await manager.async_update(user["id"], {"display_name": "Edited"}, revision=1)
    await drain(manager)
    assert device.writes[-1][2]["UserInfo"] == {"employeeNo": user["employee_no"], "name": "Edited"}
    await manager.async_delete(user["id"], revision=2)
    await drain(manager)
    assert not device.users and not manager.public()["tombstones"]


async def test_contradictory_timed_validity_is_not_inferred_as_synced(fleet):
    manager, device, driver = fleet

    async def firmware_response():
        for user in device.users.values():
            user["Valid"]["timeType"] = "local"

    device.on_write = firmware_response
    user = await manager.async_create(
        {
            "display_name": "Timed",
            "valid_from": "2026-09-09T09:00:00+00:00",
            "valid_until": "2026-09-10T09:00:00+00:00",
            "assignments": {"a": {"allowed_locks": [1]}},
        }
    )
    await drain(manager)
    assert (
        manager.repository.get(user["id"]).assignments["a"].last_error
        == "validity_timezone_mismatch"
    )
    assert manager.stations["a"].error == "validity_timezone_mismatch"
    assert manager.sync_diagnostics()["recent"][-4:]
    with pytest.raises(AccessError, match="validity_timezone_mismatch"):
        canonical(
            StationInventory(deepcopy(device.users)), user["employee_no"], driver.capabilities
        )


async def test_diagnostics_bound_redact_and_throttle_warnings(caplog):
    repo = AccessRepository(AsyncMock())
    diagnostics = SyncDiagnostics(repo.fingerprint)
    caplog.set_level(
        logging.DEBUG, logger="custom_components.hikvision_intercom.access.diagnostics"
    )
    error = HikvisionDeviceError(
        "RAW-PIN-918273 CARD-001122334455",
        sub_status="SECRET-SUBCODE",
        status_code=918273,
        fields=("SECRET-CARD",),
    )
    for _ in range(250):
        diagnostics.stage("PRIVATE-STATION", "PRIVATE-USER", "create_person")
        diagnostics.finish("PRIVATE-STATION", "PRIVATE-USER", error=error)
    report = diagnostics.public()
    assert len(report["recent"]) == 200
    assert len([record for record in caplog.records if record.levelno == logging.WARNING]) == 1
    exposed = json.dumps(report) + caplog.text
    for secret in (
        "918273",
        "001122334455",
        "PRIVATE-STATION",
        "PRIVATE-USER",
        "SECRET-SUBCODE",
        "SECRET-CARD",
    ):
        assert secret not in exposed
    report["recent"][0]["error"] = "MUTATED"
    assert "MUTATED" not in json.dumps(diagnostics.public())
    assert not diagnostics.public("OTHER-STATION")["recent"]


async def test_cancelled_user_work_is_reported_as_cancelled(fleet):
    manager, _, driver = fleet
    started = asyncio.Event()

    async def suspended(*args, **kwargs):
        started.set()
        await asyncio.Event().wait()

    driver.async_write_person = suspended
    await manager.async_create(
        {"display_name": "Resident", "assignments": {"a": {"allowed_locks": [1]}}}
    )
    await asyncio.wait_for(started.wait(), timeout=2)
    await manager.async_detach("a")
    assert any(
        row["outcome"] == "cancelled" and row["user_ref"]
        for row in manager.diagnostics.public()["recent"]
    )


async def test_unknown_worker_failure_is_private_and_observable(fleet, caplog):
    manager, _, driver = fleet
    driver.async_inventory = AsyncMock(side_effect=RuntimeError("PRIVATE-PAYLOAD-918273"))
    manager.request("a")
    await drain(manager)
    assert manager.stations["a"].error == "storage_or_internal_error"
    assert "PRIVATE-PAYLOAD" not in caplog.text + json.dumps(manager.sync_diagnostics())


def test_parser_does_not_preserve_arbitrary_device_error_text():
    with pytest.raises(HikvisionDeviceError) as caught:
        check_response_status(
            {
                "statusCode": 6,
                "subStatusCode": "PRIVATE-PIN-918273",
                "errorMsg": "beginTime and endTime PRIVATE-CARD",
                "requestURL": "http://admin:SECRET@station",
            }
        )
    assert caught.value.fields == () and caught.value.sub_status is None
    assert "PRIVATE" not in str(caught.value) and "SECRET" not in str(caught.value)
