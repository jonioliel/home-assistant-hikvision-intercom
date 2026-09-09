"""HA bridge for explicit local responsibility, preflight and read-only recovery."""

from __future__ import annotations

import asyncio
from typing import Any

from homeassistant.core import HomeAssistant

from .access.models import AccessError
from .access.schedule_executor import ScheduleExecutor, ScheduleObservation
from .access.schedule_journal import ScheduleJournal
from .access.schedule_operations import ScheduleOperations
from .access.schedule_plans import SchedulePlans
from .access.schedule_work_queue import ScheduleWorkQueue
from .access_runtime import get_manager
from .client.schedule_plan_inspection import inspect_plan
from .const import DOMAIN
from .schedule_plan_api import source


class ReadOnlySnapshot:
    """A fresh bounded read feeds recovery; no write implementation exists."""

    writes_verified = False

    def __init__(self, context: dict[str, str], result: dict[str, Any]) -> None:
        self.context, self.result = context, result

    async def observe(self, transaction: dict[str, Any]) -> ScheduleObservation:
        return ScheduleObservation(self.context, self.result["observed"], True)

    async def write(self, resource: dict[str, Any]) -> None:
        raise AccessError("schedule_writes_unverified")


def stores(hass: HomeAssistant) -> tuple[ScheduleOperations, ScheduleJournal, SchedulePlans]:
    data = hass.data[DOMAIN]
    operations, journal, plans = (
        data.get("schedule_operations"),
        data.get("schedule_journal"),
        data.get("schedule_plans"),
    )
    if (
        not isinstance(operations, ScheduleOperations)
        or not isinstance(journal, ScheduleJournal)
        or not isinstance(plans, SchedulePlans)
    ):
        raise AccessError("schedule_operations_unavailable")
    return operations, journal, plans


def checked_plan(hass: HomeAssistant, identifier: str, revision: int) -> dict[str, Any]:
    _, _, plans = stores(hass)
    plan = plans.get(identifier, revision)
    try:
        source(hass, plan["draft_id"], plan["draft_revision"])
    except AccessError:
        raise AccessError("schedule_source_changed") from None
    manager = get_manager(hass)
    driver = manager._driver(manager._station(plan["station_id"]))
    entry = hass.config_entries.async_get_entry(plan["station_id"])
    runtime = getattr(entry, "runtime_data", None)
    identity = plans.fingerprint(
        [driver.client._expected_identity, runtime.profile.firmware if runtime else None]
    )
    if identity != plan["identity"]:
        raise AccessError("schedule_plan_device_changed")
    return plan


async def read(hass: HomeAssistant, plan: dict[str, Any]) -> dict[str, Any]:
    _, _, plans = stores(hass)
    manager = get_manager(hass)
    station = manager._station(plan["station_id"])
    driver = manager._driver(station)
    busy = hass.data[DOMAIN].setdefault("schedule_reads", set())
    if plan["station_id"] in busy or len(busy) >= 3:
        raise AccessError("schedule_read_busy")
    busy.add(plan["station_id"])
    try:
        async with asyncio.timeout(130):
            async with manager._read_slots:
                result = await inspect_plan(
                    driver.client, plan["draft"], plan["bindings"], plans.fingerprint
                )
        if station.driver is not driver or manager._closed:
            raise AccessError("station_unloaded")
        checked_plan(hass, plan["id"], plan["revision"])
        return result
    except TimeoutError:
        raise AccessError("connection_failed") from None
    finally:
        busy.discard(plan["station_id"])


async def preflight(hass: HomeAssistant, job: dict[str, Any]) -> dict[str, Any]:
    operations, journal, _ = stores(hass)
    plan = checked_plan(hass, job["plan_id"], job["plan_revision"])
    inspection = await read(hass, plan)
    blockers = list(inspection["report"]["blockers"])
    try:
        ownership, owner_hash = operations.ownership(plan, inspection)
    except AccessError:
        ownership, owner_hash = "changed", operations.fingerprint([])
    if ownership == "current":
        blockers.remove("schedule_ownership_unknown")
    if ownership == "changed":
        blockers.append("schedule_ownership_changed")
    if inspection["capability_fingerprint"] != plan["capability_fingerprint"]:
        blockers.append("schedule_plan_capabilities_changed")
    journal_id = job["journal_id"]
    if set(blockers) <= {"schedule_writes_unverified"}:
        context = {
            "identity": plan["identity"],
            "capability": inspection["capability_fingerprint"],
            "ownership": owner_hash,
            "dependencies": inspection["dependency_fingerprint"],
            "source": operations.fingerprint(
                [plan["id"], plan["revision"], plan["draft_revision"]]
            ),
        }
        if journal_id is None:
            try:
                existing = journal.get(job["id"])
            except AccessError as err:
                if err.code != "schedule_deployment_not_found":
                    raise
            else:
                if existing["context"] != context:
                    raise AccessError("schedule_source_changed")
                journal_id = existing["id"]
        if journal_id is None:
            prepared = await journal.async_prepare(
                plan["station_id"],
                plan["draft"],
                plan["bindings"],
                inspection["capabilities"],
                context,
                inspection["observed"],
                set(inspection["observed"]),
                identifier=job["id"],
            )
            journal_id = prepared["id"]
        else:
            await ScheduleExecutor(journal, ReadOnlySnapshot(context, inspection)).recover(
                journal_id
            )
    return {
        "status": "blocked",
        "error": None,
        "blockers": list(dict.fromkeys(blockers)),
        "report": inspection["report"],
        "journal_id": journal_id,
        "ownership": ownership,
    }


async def dispatch_operations(
    hass: HomeAssistant, command: str, msg: dict[str, Any], actor: str
) -> Any:
    operations, journal, plans = stores(hass)
    queue: ScheduleWorkQueue = hass.data[DOMAIN]["schedule_queue"]
    action = command.removeprefix("schedules/operations_")
    if action in ("list", "export"):
        return {**operations.public(), "journal": journal.all(), "writes_enabled": False}
    if action == "claim_preview":
        plan = checked_plan(hass, msg["plan_id"], msg["revision"])
        return operations.preview_claim(plan, await read(hass, plan), actor)
    if action == "claim_confirm":
        pending = operations.pending_claim(msg["token"], actor)
        plan = checked_plan(hass, pending["item"]["plan_id"], pending["plan_revision"])
        return await operations.async_claim(msg["token"], actor, plan)
    if action == "claim_release":
        await operations.async_release(msg["claim_id"], msg["revision"])
        return {"released": True}
    if action == "create":
        plan = checked_plan(hass, msg["plan_id"], msg["revision"])
        return await operations.async_create(plan)
    if action == "check":
        return await queue.request(msg["job_id"], msg["revision"])
    if action == "cancel":

        async def cleanup(job: dict[str, Any]) -> None:
            try:
                entry = journal.get(job["journal_id"] or job["id"])
            except AccessError as err:
                if err.code != "schedule_deployment_not_found":
                    raise
            else:
                await journal.async_discard_unstarted(entry["id"], entry["revision"])

        return await queue.cancel(msg["job_id"], msg["revision"], cleanup)
    if action == "archive":
        job = operations.job(msg["job_id"], msg["revision"])
        if job["journal_id"]:
            try:
                entry = journal.get(job["journal_id"])
            except AccessError as err:
                if (
                    err.code != "schedule_deployment_not_found"
                    or journal.archived(job["journal_id"]) is None
                ):
                    raise
            else:
                await journal.async_archive_verified(entry["id"], entry["revision"])
        await operations.async_archive(job["id"], job["revision"])
        return {"archived": True}
    raise AccessError("invalid_fields")
