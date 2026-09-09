"""Generate synthetic upgrade data using ONLY a checkout of v0.23.0-alpha.1.

Usage: python generate.py /path/to/archived/0.23 /path/to/output.json
No network or real credentials. UUIDs/timestamps differ on regeneration.
"""

# ruff: noqa: E402
import asyncio
import json
import sys
from copy import deepcopy
from pathlib import Path
from unittest.mock import AsyncMock

baseline = Path(sys.argv[1]).resolve()
sys.path[:0] = [str(baseline), str(baseline / "tests")]
import httpx
from test_access_engine import CAP, PERSON, Device

from custom_components.hikvision_intercom.access.admin_audit import audit_actor
from custom_components.hikvision_intercom.access.engine import SyncEngine
from custom_components.hikvision_intercom.access.manager import AccessManager
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.client.access import AccessClient
from custom_components.hikvision_intercom.client.client import ConnectionSettings, HikvisionClient

assert Path(sys.modules[AccessRepository.__module__].__file__).is_relative_to(baseline)
assert (
    json.loads((baseline / "custom_components/hikvision_intercom/manifest.json").read_text())[
        "version"
    ]
    == "0.23.0-alpha.1"
)


async def main():
    repo = AccessRepository(AsyncMock())
    await repo.async_load(None)
    devices = {sid: Device() for sid in ("a", "b")}
    sessions, drivers = {}, {}
    for sid, device in devices.items():
        device.users["9999"] = {
            **deepcopy(PERSON),
            "employeeNo": "9999",
            "name": "Unmanaged fixture",
        }
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
    manager = AccessManager(repo)
    for sid in devices:
        manager.register(sid, "Fixture " + sid, True)
    try:
        with audit_actor("fixture-admin", "users/create"):
            resident = await repo.async_create(
                {
                    "employee_no": "1001",
                    "display_name": "Upgrade Resident",
                    "pin": "654321",
                    "cards": [{"card_no": "0000123456"}],
                    "assignments": {sid: {"allowed_locks": [1]} for sid in devices},
                }
            )
            departing = await repo.async_create(
                {
                    "employee_no": "1002",
                    "display_name": "Pending removal",
                    "pin": "771122",
                    "cards": [{"card_no": "0000223456"}],
                    "assignments": {sid: {"allowed_locks": [1]} for sid in devices},
                }
            )
            inactive = await repo.async_create(
                {"employee_no": "1003", "display_name": "Bulk resident"}
            )
        engine = SyncEngine(repo)
        for sid, driver in drivers.items():
            result = await engine.async_reconcile(sid, driver)
            assert result.failed == 0
        with audit_actor("fixture-admin", "users/update"):
            await repo.async_update(
                resident.id, {"pin": "654322", "cards": []}, expected_revision=1
            )
        with audit_actor("fixture-admin", "users/delete"):
            await repo.async_delete(departing.id, expected_revision=1)
        assert (await engine.async_reconcile("a", drivers["a"])).failed == 0
        review = await manager.bulk.preview(
            "fixture-admin",
            {"action": "disable", "selection": [{"user_id": inactive.id, "revision": 1}]},
        )
        receipt = await manager.bulk.apply("fixture-admin", review["operation_id"])
        # A process exited while writes to the second station were pending.
        await repo.async_mark("b", resident.id, "syncing")
        await repo.async_mark("b", departing.id, "syncing")
        output = {
            "source": {
                "version": "0.23.0-alpha.1",
                "commit": "bb2c9a6a1bcc5234750bb87dfcfee2dfa2cae45f",
                "synthetic": True,
            },
            "store": {
                "version": 1,
                "minor_version": 1,
                "key": "hikvision_intercom.users",
                "data": repo.snapshot(),
            },
            "devices": {
                sid: {"users": device.users, "cards": device.cards}
                for sid, device in devices.items()
            },
            "expected": {
                "resident": resident.id,
                "departing": departing.id,
                "inactive": inactive.id,
                "receipt": receipt,
            },
        }
        await asyncio.to_thread(
            Path(sys.argv[2]).write_text,
            json.dumps(output, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print("Synthetic 0.23 fixture generated; 2 stations, 2 retained users, 1 pending deletion")
    finally:
        await manager.async_close()
        await asyncio.gather(*(session.aclose() for session in sessions.values()))


asyncio.run(main())
