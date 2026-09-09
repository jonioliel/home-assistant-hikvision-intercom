"""Run deterministic schedule recovery scenarios entirely in memory, without network I/O.

Usage: python -m tools.simulate_schedule_recovery [--scenario all] [--output report.json]
Reports are synthetic test evidence, never proof of firmware support or door enforcement.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.schedule_compiler import compile_schedule
from custom_components.hikvision_intercom.access.schedule_executor import (
    ScheduleExecutor,
    ScheduleObservation,
)
from custom_components.hikvision_intercom.access.schedule_journal import CONTEXT, ScheduleJournal
from custom_components.hikvision_intercom.access.schedules import DAYS

SCENARIOS = (
    "success",
    "lost_ack_applied",
    "lost_ack_not_applied",
    "crash_applied",
    "crash_not_applied",
    "offline_readback",
    "external_change",
    "context_change",
    "failed_intent_save",
)


class MemoryDisk:
    """Serialize every successful save; restart uses only that committed JSON."""

    def __init__(self) -> None:
        self.committed = "null"
        self.fail = False

    async def save(self, data: dict[str, Any]) -> None:
        if self.fail:
            raise AccessError("storage_write_failed")
        self.committed = json.dumps(data)


class SimulatedTransport:
    writes_verified = True  # This class has no device or network connection.

    def __init__(self, observed: dict[str, Any], context: dict[str, str], scenario: str) -> None:
        self.records, self.context = deepcopy(observed), deepcopy(context)
        self.scenario = scenario
        self.writes: list[str] = []
        self.reads = 0

    async def observe(self, transaction: dict[str, Any]) -> ScheduleObservation:
        self.reads += 1
        if self.scenario == "offline_readback" and self.reads == 3:
            raise TimeoutError("Synthetic offline read")
        if self.scenario == "external_change" and self.reads == 4:
            self.records["weekly:20"]["UserRightWeekPlanCfg"]["enable"] = False
        if self.scenario == "context_change":
            self.context["dependencies"] = "c" * 64
        return ScheduleObservation(deepcopy(self.context), deepcopy(self.records), True)

    async def write(self, resource: dict[str, Any]) -> None:
        self.writes.append(resource["key"])
        if self.scenario not in ("lost_ack_not_applied", "crash_not_applied"):
            self.records[resource["key"]] = deepcopy(resource["body"])
        if self.scenario.startswith("crash_"):
            raise asyncio.CancelledError
        if self.scenario.startswith("lost_ack_"):
            raise TimeoutError("Synthetic lost acknowledgement")


async def simulate(scenario: str) -> dict[str, Any]:
    if scenario not in SCENARIOS:
        raise ValueError("Unknown simulation scenario")
    draft = {
        "name": "Synthetic office hours",
        "weekly": {
            day: [{"start": "09:00", "end": "17:00"}] if day == "Monday" else [] for day in DAYS
        },
        "holidays": [],
    }
    bindings = {"template": 10, "weekly": 20, "holiday_group": None, "holidays": []}
    caps = {
        "weekly": {
            "ids": [1, 255],
            "period_ids": [1, 8],
            "max_periods": 56,
            "precision": "minute",
            "weekdays": list(DAYS),
        },
        "template": {"ids": [1, 255], "week_ids": [1, 255], "name_length": [0, 32]},
    }
    candidates = compile_schedule(draft, bindings, caps)
    observed = {r["key"]: deepcopy(r["body"]) for r in candidates}
    for body in observed.values():
        next(iter(body.values()))["enable"] = False
    context = {key: "b" * 64 for key in CONTEXT}
    disk = MemoryDisk()
    journal = ScheduleJournal(disk.save)
    created = await journal.async_prepare(
        "synthetic-station", draft, bindings, caps, context, observed, set(observed)
    )
    identifier = created["id"]
    transport = SimulatedTransport(observed, context, scenario)
    executor = ScheduleExecutor(journal, transport)
    disk.fail = scenario == "failed_intent_save"
    try:
        await executor.execute(identifier)
    except asyncio.CancelledError:
        if not scenario.startswith("crash_"):
            raise
    except AccessError:
        if scenario != "failed_intent_save":
            raise
    initial = journal.public(identifier)
    writes = list(transport.writes)
    disk.fail = False
    restored = ScheduleJournal(disk.save)
    await restored.async_load(json.loads(disk.committed))
    # A restored process may inspect the unknown outcome, but recovery never writes.
    recovered = await ScheduleExecutor(restored, transport).recover(identifier)
    assert transport.writes == writes, "Recovery must not replay writes"
    expected = {
        "success": "verified",
        "lost_ack_applied": "ready",
        "lost_ack_not_applied": "recovery_required",
        "crash_applied": "ready",
        "crash_not_applied": "recovery_required",
        "offline_readback": "ready",
        "external_change": "conflict",
        "context_change": "conflict",
        "failed_intent_save": "ready",
    }
    assert recovered["status"] == expected[scenario], "Unexpected recovery state"
    assert len(writes) == len(set(writes)), "An intent was written more than once"
    return {
        "scenario": scenario,
        "initial_status": initial["status"],
        "recovered_status": recovered["status"],
        "issue": recovered["issue"],
        "simulated_writes": writes,
        "reads": transport.reads,
        "recovery_writes": 0,
        "steps": recovered["steps"],
        "passed": True,
    }


async def report(scenario: str = "all") -> dict[str, Any]:
    chosen = SCENARIOS if scenario == "all" else (scenario,)
    return {
        "schema": 1,
        "simulation_only": True,
        "hardware_verified": False,
        "network_requests": 0,
        "scenarios": [await simulate(name) for name in chosen],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", choices=("all", *SCENARIOS), default="all")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    output = json.dumps(asyncio.run(report(args.scenario)), indent=2) + "\n"
    if args.output:
        args.output.write_text(output, encoding="utf-8")
    print(output, end="")


if __name__ == "__main__":
    main()
