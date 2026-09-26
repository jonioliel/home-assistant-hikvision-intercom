"""User-owned native plans, guarded allocation, durable writes and fresh readback.

Only explicit user activation enters this path. Unknown implicit references block
allocation; they are not evidence of unused slots. No default plan is overwritten.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Any
from uuid import NAMESPACE_URL, uuid5

from ..client.access import AccessClient
from ..client.clock import ClockClient
from ..client.parser import find_values
from ..client.schedule_dependencies import read_user_dependencies
from ..client.schedule_inventory import inspect_inventory
from ..client.schedule_plan_inspection import inspect_plan
from ..clock import _transition, named_zone, offset_at
from ..exceptions import HikvisionDeviceError
from .models import AccessError, ManagedUser
from .schedule_comparison import canonical
from .schedule_compiler import ROOTS, compile_schedule
from .schedule_executor import ScheduleExecutor, ScheduleObservation
from .schedule_journal import ScheduleJournal
from .user_timing_plan import right_plan, user_schedule


@lru_cache(maxsize=64)
def compatible_zone(device_json: str, name: str, year: int) -> bool:
    device, requested = json.loads(device_json), named_zone(name)
    # Check all recurring rules through the supported validity horizon, including
    # exact device transitions (different change hours must not pass a noon check).
    when, end = datetime(year, 1, 1, tzinfo=UTC), datetime(2038, 1, 1, tzinfo=UTC)
    while when < end:
        if offset_at(when, device) != offset_at(when, requested):
            return False
        when += timedelta(hours=6)
    if device.get("kind") == "device" and device.get("delta"):
        for y in range(year, 2038):
            for rule, delta in (("start", 0), ("end", device["delta"])):
                when = _transition(y, device[rule], device["standard"] + delta)
                for seconds in (-1, 0, 1):
                    probe = when + timedelta(seconds=seconds)
                    if offset_at(probe, device) != offset_at(probe, requested):
                        return False
    return True


class NativeTiming:
    def __init__(self, journal: ScheduleJournal, repository: Any = None) -> None:
        self.journal = journal
        self.repository = repository

    def owns(self, station: str, user: ManagedUser, plans: Any) -> bool:
        if not isinstance(plans, list) or not plans:
            return False
        owner = self.journal.fingerprint([station, user.id])
        identifiers = {
            item["bindings"]["template"]
            for item in (self.journal.get(row["id"]) for row in self.journal.all())
            if item["station_id"] == station
            and item["context"]["ownership"] == owner
            and item["status"] == "verified"
        }
        return all(
            isinstance(p, dict)
            and p.get("planTemplateNo") in {str(i) for i in identifiers}
            and p.get("doorNo") in (1, 2)
            for p in plans
        )

    async def _allocate(
        self, station: str, driver: AccessClient, user: ManagedUser, draft: dict[str, Any]
    ) -> dict[str, Any]:
        rows: dict[str, list[dict[str, Any]]] = {}
        inventory = await inspect_inventory(driver.client, projected=rows)
        references: set[int] = set()
        dependencies = await read_user_dependencies(
            driver.client, inventory, rows, references=references, ignore_employee=user.employee_no
        )
        needed = {"template", "weekly"} | (
            {"holiday_group", "holiday"} if draft["holidays"] else set()
        )
        if any(c["state"] != "complete" for c in inventory["checks"] if c["kind"] in needed):
            raise AccessError("schedule_inventory_incomplete")
        if not dependencies["users_checked"]:
            raise AccessError("schedule_plan_users_unreadable")
        if dependencies["users"]["implicit"] or dependencies["users"]["malformed"]:
            raise AccessError("schedule_plan_user_defaults")
        # Existing journal resources remain reserved, including interrupted work.
        reserved: dict[str, set[int]] = {kind: set() for kind in ROOTS}
        for item in (self.journal.get(row["id"]) for row in self.journal.all()):
            if item["station_id"] != station:
                continue
            for resource in compile_schedule(item["draft"], item["bindings"], item["capabilities"]):
                reserved[resource["kind"]].add(resource["id"])
        for template in rows.get("template", []):
            tid = template["id"]
            if (
                template["enabled"]
                or tid in references
                or tid in reserved["template"]
                or tid > 65532
            ):
                continue
            external_weeks = {r["week"] for r in rows["template"] if r["id"] != tid}
            week = next(
                (
                    r["id"]
                    for r in rows.get("weekly", [])
                    if not r["enabled"]
                    and r["id"] <= 65532
                    and r["id"] not in external_weeks | reserved["weekly"]
                ),
                None,
            )
            if week is None:
                continue
            if not draft["holidays"]:
                return {"template": tid, "weekly": week, "holiday_group": None, "holidays": []}
            external_groups = {
                i for r in rows["template"] if r["id"] != tid for i in r["references"]
            }
            for group in rows.get("holiday_group", []):
                gid = group["id"]
                if group["enabled"] or gid in external_groups | reserved["holiday_group"]:
                    continue
                external_holidays = {
                    i for r in rows["holiday_group"] if r["id"] != gid for i in r["references"]
                }
                holidays = [
                    r["id"]
                    for r in rows.get("holiday", [])
                    if not r["enabled"] and r["id"] not in external_holidays | reserved["holiday"]
                ]
                if len(holidays) >= len(draft["holidays"]):
                    return {
                        "template": tid,
                        "weekly": week,
                        "holiday_group": gid,
                        "holidays": holidays[: len(draft["holidays"])],
                    }
        raise AccessError("schedule_no_safe_slots")

    async def ensure(
        self, station: str, user: ManagedUser, driver: AccessClient, doors: tuple[int, ...]
    ) -> list[dict[str, Any]]:
        driver._require_mutation("UserInfo", "put")
        if not driver.client._expected_identity:
            raise AccessError("schedule_plan_device_changed")
        assert user.access_timing_policy is not None
        policy: dict[str, Any] = user.access_timing_policy
        assert policy["mode"] == "native"
        clock = await ClockClient(driver.client).async_read()
        measurement = clock["measurement"]
        if (
            measurement["status"] != "measured"
            or abs(measurement["estimated_skew_seconds"]) + measurement["uncertainty_seconds"] > 10
        ):
            raise AccessError("schedule_station_clock_unverified")
        if not await asyncio.to_thread(
            compatible_zone,
            json.dumps(clock["zone"], sort_keys=True),
            policy["schedule"]["timezone"],
            datetime.now(UTC).year,
        ):
            raise AccessError("schedule_station_timezone_unverified")
        source = self.journal.fingerprint([station, user.id, policy])
        identifier = str(uuid5(NAMESPACE_URL, "wiskey-user-timing:" + source))
        draft = user_schedule(policy["schedule"])
        try:
            item = self.journal.get(identifier)
        except AccessError as err:
            if err.code != "schedule_deployment_not_found":
                raise
            slots = policy["bindings"].get(station) or await self._allocate(
                station, driver, user, draft
            )
            item = None
        else:
            assert item is not None
            slots = item["bindings"]
        capability = await driver._json(
            "GET", "/ISAPI/AccessControl/UserInfo/capabilities?format=json"
        )
        plans = right_plan(
            doors, slots["template"], capability.get("UserInfo", {}).get("RightPlan")
        )

        async def observe(transaction: dict[str, Any] | None = None) -> ScheduleObservation:
            if self.repository is not None:
                latest = self.repository.get(user.id)
                if (
                    latest.access_timing_policy != policy
                    or not latest.active
                    or latest.assignments.get(station) is None
                    or latest.assignments[station].serialize()
                    != user.assignments[station].serialize()
                ):
                    raise AccessError("revision_conflict")
            report = await inspect_plan(
                driver.client,
                draft,
                slots,
                self.journal.fingerprint,
                ignore_employee=user.employee_no,
            )
            needed = {r["kind"] for r in report["candidates"]}
            # Holiday membership cannot be inferred from other tests. User chooses
            # HA validity for dates when native holiday semantics remain unknown.
            blockers = set(report["report"]["blockers"]) - {
                "schedule_writes_unverified",
                "schedule_ownership_unknown",
                "schedule_plan_active_resources",
                "schedule_inventory_incomplete",
            }
            if any(
                r["coverage"] != "complete"
                for r in report["report"]["resources"]
                if r["kind"] in needed
            ):
                blockers.add("schedule_inventory_incomplete")
            if blockers:
                raise AccessError(sorted(blockers)[0])
            context = {
                "identity": self.journal.fingerprint(driver.client._expected_identity),
                "capability": report["capability_fingerprint"],
                "dependencies": report["external_context"],
                "ownership": self.journal.fingerprint([station, user.id]),
                "source": source,
            }
            if transaction is None:
                if any(r["active"] for r in report["report"]["resources"]):
                    raise AccessError("schedule_plan_active_resources")
                return ScheduleObservation(context, report["observed"], True)
            return ScheduleObservation(context, report["observed"], True)

        if item is None:
            initial = await observe()
            inspected = await inspect_plan(
                driver.client,
                draft,
                slots,
                self.journal.fingerprint,
                ignore_employee=user.employee_no,
            )
            item = await self.journal.async_prepare(
                station,
                draft,
                slots,
                inspected["capabilities"],
                initial.context,
                initial.records,
                set(initial.records),
                identifier=identifier,
            )
        transport = _LockedTransport(driver, self.journal, identifier, observe)
        result = await ScheduleExecutor(self.journal, transport, timeout=60).execute(identifier)
        if result["status"] != "verified":
            raise AccessError("schedule_deployment_incomplete")
        # Executor's verified fast path is not a new observation: recheck exact bodies.
        observed = await observe(self.journal.get(identifier))
        current = self.journal.get(identifier)
        if observed.context != current["context"]:
            raise AccessError("schedule_source_changed")
        for resource in compile_schedule(draft, slots, current["capabilities"]):
            if canonical(resource["kind"], observed.records[resource["key"]]) != canonical(
                resource["kind"], resource["body"]
            ):
                raise AccessError("schedule_resource_changed")
        driver._verified_right_plans[user.employee_no] = deepcopy(plans)
        return plans


class _LockedTransport:
    writes_verified = True

    def __init__(
        self,
        driver: AccessClient,
        journal: ScheduleJournal,
        identifier: str,
        observer: Callable[[dict[str, Any] | None], Awaitable[ScheduleObservation]],
    ) -> None:
        self.driver, self.journal, self.identifier, self.observer = (
            driver,
            journal,
            identifier,
            observer,
        )
        self.attempted: set[str] = set()

    async def observe(self, item: dict[str, Any]) -> ScheduleObservation:
        return await self.observer(item)

    async def write(self, resource: dict[str, Any]) -> None:
        self.driver._require_mutation("UserInfo", "put")
        item = self.journal.get(self.identifier)
        candidates = compile_schedule(item["draft"], item["bindings"], item["capabilities"])
        if resource not in candidates or resource["key"] in self.attempted:
            raise AccessError("schedule_deployment_invalid")
        intent = next((r for r in item["steps"] if r["state"] == "intent"), None)
        if intent is None or intent["key"] != resource["key"]:
            raise AccessError("schedule_deployment_invalid")
        self.attempted.add(resource["key"])
        result = await self.driver._json(
            "PUT",
            f"/ISAPI/AccessControl/{ROOTS[resource['kind']]}/{resource['id']}?format=json",
            deepcopy(resource["body"]),
        )
        codes = find_values(result, "statusCode")
        if not codes or any(str(c) != "1" for c in codes):
            raise HikvisionDeviceError("Schedule write was not acknowledged")
