"""Explicit commissioning transport for the documented native schedule PUT routes.

Not registered as a background job or public API. A coordinated commissioning caller
must supply fresh ownership/dependency/clock observations and explicit authorization.
The ordinary integration still cannot activate an uncommissioned station implicitly.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from copy import deepcopy
from typing import Any

from ..access.models import AccessError
from ..access.schedule_comparison import canonical
from ..access.schedule_compiler import ROOTS, compile_schedule
from ..access.schedule_executor import ScheduleObservation
from ..access.schedule_journal import ScheduleJournal, validate_context
from ..exceptions import HikvisionDeviceError
from .access import AccessClient
from .parser import find_values

Observer = Callable[[dict[str, Any]], Awaitable[ScheduleObservation]]


class CommissioningScheduleTransport:
    """One journal-bound plan; no generic URL, allocation or implicit retry support."""

    def __init__(
        self,
        driver: AccessClient,
        journal: ScheduleJournal,
        identifier: str,
        observer: Observer,
        *,
        authorized: bool = False,
    ) -> None:
        if not driver.client._expected_identity:
            raise AccessError("schedule_plan_device_changed")
        self.driver, self.journal, self.identifier = driver, journal, identifier
        self._observer = observer
        self.writes_verified = authorized is True
        self._attempted: set[str] = set()
        self._fresh = {
            s["key"] for s in journal.get(identifier)["steps"] if s["state"] == "pending"
        }

    async def observe(self, transaction: dict[str, Any]) -> ScheduleObservation:
        if transaction != self.journal.get(self.identifier):
            raise AccessError("schedule_source_changed")
        return await self._observer(deepcopy(transaction))

    async def write(self, resource: dict[str, Any]) -> None:
        if self.writes_verified is not True:
            raise AccessError("schedule_writes_unverified")
        # The same lock serializes relay, person and schedule writes on this station.
        async with self.driver.transaction():
            self.driver._require_mutation("UserInfo", "put")
            item = self.journal.get(self.identifier)
            candidates = compile_schedule(item["draft"], item["bindings"], item["capabilities"])
            candidate = next((r for r in candidates if r == resource), None)
            if candidate is None or item["status"] != "recovery_required":
                raise AccessError("schedule_deployment_invalid")
            intent = next((s for s in item["steps"] if s["state"] == "intent"), None)
            if intent is None or intent["key"] != candidate["key"]:
                raise AccessError("schedule_deployment_invalid")
            if candidate["key"] not in self._fresh or candidate["key"] in self._attempted:
                raise AccessError("schedule_write_uncertain")
            observed = await self.observe(item)
            validate_context(observed.context)
            if observed.eligible is not True or observed.context != item["context"]:
                raise AccessError("schedule_source_changed")
            if set(observed.records) != {r["key"] for r in candidates}:
                raise AccessError("schedule_observation_invalid")
            for row, expected in zip(item["steps"], candidates, strict=True):
                actual = self.journal.fingerprint(
                    canonical(expected["kind"], observed.records[row["key"]])
                )
                # Here an intent must still match its BEFORE image. The executor handles
                # AFTER-only recovery; this adapter never resends an already applied PUT.
                digest = row["after"] if row["state"] == "verified" else row["before"]
                if actual != digest:
                    raise AccessError("schedule_resource_changed")
            if item != self.journal.get(self.identifier) or self.writes_verified is not True:
                raise AccessError("schedule_source_changed")
            self._attempted.add(candidate["key"])
            result = await self.driver._json(
                "PUT",
                f"/ISAPI/AccessControl/{ROOTS[candidate['kind']]}/{candidate['id']}?format=json",
                deepcopy(candidate["body"]),
            )
            codes = find_values(result, "statusCode")
            if not codes or any(str(code) != "1" for code in codes):
                raise HikvisionDeviceError("Schedule write was not acknowledged")
