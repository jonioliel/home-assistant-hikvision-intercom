"""HA operations API: privacy, durable jobs, source guards and orphan recovery."""

import asyncio
import json
from copy import deepcopy
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.schedule_journal import ScheduleJournal
from custom_components.hikvision_intercom.access.schedule_operations import ScheduleOperations
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.storage import AccessStore

from .test_schedule_plans import BINDINGS
from .test_schedule_plans import inspection as base_inspection
from .test_schedules import draft
from .test_websocket import request


def inspection():
    data = base_inspection()
    data["dependency_fingerprint"] = "d" * 64
    data["observed"] = {r["key"]: deepcopy(r["body"]) for r in data["candidates"]}
    for body in data["observed"].values():
        next(iter(body.values()))["enable"] = False
    return data


async def proposal(client, station):
    created = (await request(client, "schedules/create", data=draft()))["result"]
    with patch(
        "custom_components.hikvision_intercom.schedule_plan_api.inspect_plan",
        AsyncMock(return_value=inspection()),
    ):
        preview = (
            await request(
                client,
                "schedules/plan_preview",
                station_id=station,
                schedule_id=created["id"],
                revision=1,
                bindings=BINDINGS,
            )
        )["result"]
        saved = (await request(client, "schedules/plan_save", token=preview["token"]))["result"]
    return created, saved


async def declare(client, saved):
    with patch(
        "custom_components.hikvision_intercom.schedule_operations_api.inspect_plan",
        AsyncMock(return_value=inspection()),
    ):
        review = (
            await request(
                client,
                "schedules/operations_claim_preview",
                plan_id=saved["id"],
                revision=saved["revision"],
            )
        )["result"]
    result = await request(client, "schedules/operations_claim_confirm", token=review["token"])
    assert result["success"]
    return result["result"]


async def check(hass, client, job):
    with patch(
        "custom_components.hikvision_intercom.schedule_operations_api.inspect_plan",
        AsyncMock(return_value=inspection()),
    ):
        result = await request(
            client, "schedules/operations_check", job_id=job["id"], revision=job["revision"]
        )
        assert result["success"]
        await asyncio.gather(*hass.data[DOMAIN]["schedule_queue"]._tasks.values())
    return hass.data[DOMAIN]["schedule_operations"].job(job["id"])


async def test_operations_complete_local_lifecycle_private_storage_and_export(
    hass, loaded_entry, hass_ws_client, device_io
):
    client = await hass_ws_client(hass)
    _, saved = await proposal(client, loaded_entry.entry_id)
    claim = await declare(client, saved)
    job = (await request(client, "schedules/operations_create", plan_id=saved["id"], revision=1))[
        "result"
    ]
    current = await check(hass, client, job)
    assert current["status"] == "blocked" and current["ownership"] == "current"
    assert current["blockers"] == ["schedule_writes_unverified"]
    assert current["journal_id"] == job["id"]
    exported = (await request(client, "schedules/operations_export"))["result"]
    assert exported["writes_enabled"] is False
    assert exported["journal"][0]["status"] == "ready"
    serialized = json.dumps(exported)
    assert all(
        k not in serialized
        for k in ["fingerprint", "observed", "capabilities", "identity", "d" * 64, "e" * 64]
    )
    for key, cls in [
        ("schedule_operations", ScheduleOperations),
        ("schedule_journal", ScheduleJournal),
    ]:
        store = AccessStore(hass, key=f"{DOMAIN}.{key}")
        other = cls(AsyncMock())
        await other.async_load(await store.async_load())
        mode = await hass.async_add_executor_job(
            lambda store=store: Path(store.path).stat().st_mode & 0o777
        )
        assert mode == 0o600
    cancelled = (
        await request(
            client, "schedules/operations_cancel", job_id=job["id"], revision=current["revision"]
        )
    )["result"]
    assert (
        await request(
            client, "schedules/operations_archive", job_id=job["id"], revision=cancelled["revision"]
        )
    )["success"]
    assert (
        await request(
            client, "schedules/operations_claim_release", claim_id=claim["id"], revision=1
        )
    )["success"]
    public = (await request(client, "schedules/operations_list"))["result"]
    assert not public["jobs"] and not public["claims"] and not public["journal"]
    assert len(public["archive"]) == 1
    device_io["unlock"].assert_not_called()
    device_io["write_person"].assert_not_called()


async def test_without_declaration_no_journal_is_prepared(hass, loaded_entry, hass_ws_client):
    client = await hass_ws_client(hass)
    _, saved = await proposal(client, loaded_entry.entry_id)
    job = (await request(client, "schedules/operations_create", plan_id=saved["id"], revision=1))[
        "result"
    ]
    current = await check(hass, client, job)
    assert current["ownership"] == "missing" and current["journal_id"] is None
    assert "schedule_ownership_unknown" in current["blockers"]


async def test_changed_source_never_reads_station_or_prepares_journal(
    hass, loaded_entry, hass_ws_client
):
    client = await hass_ws_client(hass)
    source, saved = await proposal(client, loaded_entry.entry_id)
    job = (await request(client, "schedules/operations_create", plan_id=saved["id"], revision=1))[
        "result"
    ]
    await request(
        client,
        "schedules/update",
        schedule_id=source["id"],
        revision=1,
        data={**draft(), "name": "Changed"},
    )
    with patch(
        "custom_components.hikvision_intercom.schedule_operations_api.inspect_plan", AsyncMock()
    ) as read:
        await request(client, "schedules/operations_check", job_id=job["id"], revision=1)
        await asyncio.gather(*hass.data[DOMAIN]["schedule_queue"]._tasks.values())
        read.assert_not_called()
    current = hass.data[DOMAIN]["schedule_operations"].job(job["id"])
    assert current["error"] == "schedule_source_changed" and not current["journal_id"]


async def test_prepared_journal_survives_failed_job_save_and_is_reused(
    hass, loaded_entry, hass_ws_client
):
    client = await hass_ws_client(hass)
    _, saved = await proposal(client, loaded_entry.entry_id)
    await declare(client, saved)
    job = (await request(client, "schedules/operations_create", plan_id=saved["id"], revision=1))[
        "result"
    ]
    operations = hass.data[DOMAIN]["schedule_operations"]
    original = operations._save

    async def save(data):
        if data["jobs"][job["id"]]["status"] == "blocked":
            raise AccessError("storage_write_failed")
        await original(data)

    with patch.object(operations, "_save", save):
        current = await check(hass, client, job)
    assert current["status"] == "failed" and current["journal_id"] is None
    assert len(hass.data[DOMAIN]["schedule_journal"].all()) == 1
    retried = await check(hass, client, current)
    assert retried["journal_id"] == job["id"] and retried["status"] == "blocked"
    assert len(hass.data[DOMAIN]["schedule_journal"].all()) == 1


@pytest.mark.parametrize("key", ["schedule_journal", "schedule_operations"])
async def test_corrupt_operations_store_is_isolated_with_repair(hass, device_io, key):
    from homeassistant.helpers import issue_registry as ir
    from pytest_homeassistant_custom_component.common import MockConfigEntry

    from .conftest import DATA, PROFILE

    entry = MockConfigEntry(domain=DOMAIN, title="Front", unique_id=PROFILE.unique_id, data=DATA)
    entry.add_to_hass(hass)
    original = AccessStore.async_load

    async def load(store):
        if store.key.endswith("." + key):
            raise AccessError("invalid_storage")
        return await original(store)

    with patch.object(AccessStore, "async_load", load):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
    assert hass.data[DOMAIN][key] is None and hass.data[DOMAIN]["access"] is not None
    assert ir.async_get(hass).async_get_issue(DOMAIN, key + "_storage_corrupt")
    await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
