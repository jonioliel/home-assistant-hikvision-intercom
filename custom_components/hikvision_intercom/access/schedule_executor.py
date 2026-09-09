"""Readback-driven schedule executor, usable only with a verified transport adapter.

There is deliberately no production adapter in this release. In particular, a proposal,
successful capability read, or readback alone cannot establish ownership or write support.
"""

from __future__ import annotations

import asyncio
from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Protocol

from .models import AccessError
from .schedule_comparison import canonical
from .schedule_compiler import compile_schedule
from .schedule_journal import ScheduleJournal, validate_context


@dataclass(frozen=True)
class ScheduleObservation:
    """Private verified read, including identity/source/capability/dependency/ownership context.

    eligible requires complete relevant inventory, explicit ownership and understood user
    dependencies. This flag must be computed by a trusted adapter, never read from the device.
    Context excludes the contents of resources this transaction is changing.
    """

    context: dict[str, str]
    records: dict[str, Any]
    eligible: bool


class ScheduleTransport(Protocol):
    writes_verified: bool

    async def observe(self, transaction: dict[str, Any]) -> ScheduleObservation: ...

    async def write(self, resource: dict[str, Any]) -> None: ...


class ScheduleExecutor:
    def __init__(
        self, journal: ScheduleJournal, transport: ScheduleTransport, *, timeout: float = 30
    ) -> None:
        if not 0 < timeout <= 60:
            raise ValueError("Invalid schedule I/O deadline")
        self.journal, self.transport, self.timeout = journal, transport, timeout

    async def _observe(self, item: dict[str, Any]) -> dict[str, str] | None:
        failed = False
        try:
            async with asyncio.timeout(self.timeout):
                observed = await self.transport.observe(deepcopy(item))
            validate_context(observed.context)
            resources = compile_schedule(item["draft"], item["bindings"], item["capabilities"])
            if not isinstance(observed.records, dict) or set(observed.records) != {
                r["key"] for r in resources
            }:
                raise AccessError("schedule_deployment_invalid")
            hashes = {
                r["key"]: self.journal.fingerprint(canonical(r["kind"], observed.records[r["key"]]))
                for r in resources
            }
        except Exception:
            # Leave the exception handler before saving: a storage error must not chain
            # an adapter exception containing raw station data.
            failed = True
        if failed:
            await self.journal.async_record(item["id"], item["revision"], issue="read_failed")
            return None
        if observed.eligible is not True or observed.context != item["context"]:
            await self.journal.async_record(item["id"], item["revision"], issue="context_changed")
            return None
        for row in item["steps"]:
            accepted = (
                {row["before"], row["after"]}
                if row["state"] == "intent"
                else {row["after"] if row["state"] == "verified" else row["before"]}
            )
            if hashes[row["key"]] not in accepted:
                await self.journal.async_record(
                    item["id"], item["revision"], issue="resource_changed"
                )
                return None
        return hashes

    async def _recover(self, identifier: str) -> None:
        item = self.journal.get(identifier)
        hashes = await self._observe(item)
        if hashes is None:
            return
        for index, row in enumerate(item["steps"]):
            if row["state"] == "intent":
                if hashes[row["key"]] == row["after"]:
                    await self.journal.async_record(
                        identifier, item["revision"], index=index, step_state="verified"
                    )
                else:
                    await self.journal.async_record(
                        identifier, item["revision"], issue="write_uncertain"
                    )
                return
        if item["issue"] is not None:
            await self.journal.async_record(identifier, item["revision"])

    async def recover(self, identifier: str) -> dict[str, Any]:
        """Read only. Never resend an intent or start a pending resource."""
        async with self.journal.execution(identifier):
            if self.journal.get(identifier)["status"] not in ("verified", "conflict"):
                await self._recover(identifier)
            return self.journal.public(identifier)

    async def execute(self, identifier: str) -> dict[str, Any]:
        if self.transport.writes_verified is not True:
            raise AccessError("schedule_writes_unverified")
        async with self.journal.execution(identifier):
            item = self.journal.get(identifier)
            if item["status"] in ("verified", "conflict"):
                return self.journal.public(identifier)
            if any(s["state"] == "intent" for s in item["steps"]):
                await self._recover(identifier)
                return self.journal.public(identifier)
            resources = compile_schedule(item["draft"], item["bindings"], item["capabilities"])
            for index, resource in enumerate(resources):
                item = self.journal.get(identifier)
                row = item["steps"][index]
                if row["state"] == "verified":
                    continue
                if await self._observe(item) is None:
                    break
                if row["before"] == row["after"]:
                    await self.journal.async_record(
                        identifier, item["revision"], index=index, step_state="verified"
                    )
                    continue
                # An ambiguous intent can never be rewritten, even after process restart.
                item = await self.journal.async_record(
                    identifier, item["revision"], index=index, step_state="intent"
                )
                hashes = await self._observe(item)
                if hashes is None:
                    break
                if hashes[row["key"]] == row["after"]:
                    await self.journal.async_record(
                        identifier, item["revision"], index=index, step_state="verified"
                    )
                    continue
                if self.transport.writes_verified is not True:
                    await self.journal.async_record(
                        identifier, item["revision"], issue="context_changed"
                    )
                    break
                write_failed = False
                try:
                    async with asyncio.timeout(self.timeout):
                        await self.transport.write(deepcopy(resource))
                except Exception:
                    write_failed = True
                await self._recover(identifier)
                if write_failed:
                    break
                if self.journal.get(identifier)["status"] in ("recovery_required", "conflict"):
                    break
            return self.journal.public(identifier)
