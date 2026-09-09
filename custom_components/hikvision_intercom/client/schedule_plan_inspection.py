"""Read-only comparison of explicitly selected resources; never allocate from absence."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from ..access.models import utc_now
from ..access.schedule_comparison import compare_resource
from ..access.schedule_compiler import bindings_for, compile_schedule
from ..access.schedules import normalize
from .client import HikvisionClient
from .schedule_dependencies import read_user_dependencies
from .schedule_inventory import inspect_inventory


async def inspect_plan(
    client: HikvisionClient, draft: Any, bindings: Any, fingerprint: Callable[[Any], str]
) -> dict[str, Any]:
    draft = normalize(draft)
    slots = bindings_for(bindings, len(draft["holidays"]))
    selected = {
        "template": {slots["template"]},
        "weekly": {slots["weekly"]},
        "holiday_group": {slots["holiday_group"]} if slots["holiday_group"] else set(),
        "holiday": set(slots["holidays"]),
    }
    records: dict[str, dict[str, Any]] = {}
    projected: dict[str, list[dict[str, Any]]] = {}
    inventory = await inspect_inventory(
        client, selected=selected, records=records, projected=projected
    )
    caps = {c["kind"]: c["capabilities"] for c in inventory["checks"]}
    candidates = compile_schedule(draft, slots, caps)
    user_refs: set[int] = set()
    dependencies = await read_user_dependencies(client, inventory, projected, references=user_refs)
    states = {c["kind"]: c["state"] for c in inventory["checks"]}
    external = {
        "template": user_refs,
        "weekly": {
            r["week"] for r in projected.get("template", []) if r["id"] not in selected["template"]
        },
        "holiday_group": {
            i
            for r in projected.get("template", [])
            if r["id"] not in selected["template"]
            for i in r["references"]
        },
        "holiday": {
            i
            for r in projected.get("holiday_group", [])
            if r["id"] not in selected["holiday_group"]
            for i in r["references"]
        },
    }
    # A count of observed references is not a count of effective users or proof of ownership.
    sources = {"weekly": "template", "holiday_group": "template", "holiday": "holiday_group"}
    report_rows, hashes = [], {}
    for resource in candidates:
        kind, identifier = resource["kind"], resource["id"]
        observed = records.get(kind, {}).get(str(identifier))
        hashes[resource["key"]] = fingerprint(observed) if observed is not None else None
        known = (
            dependencies["users_checked"]
            if kind == "template"
            else states[sources[kind]] in {"complete", "partial"}
        )
        report_rows.append(
            {
                "kind": kind,
                "id": identifier,
                "coverage": states[kind],
                **compare_resource(kind, resource["body"], observed),
                "externally_referenced": identifier in external[kind] if known else None,
            }
        )
    blockers = ["schedule_writes_unverified", "schedule_ownership_unknown"]
    if not inventory["complete"]:
        blockers.append("schedule_inventory_incomplete")
    if not dependencies["users_checked"]:
        blockers.append("schedule_plan_users_unreadable")
    elif dependencies["users"]["implicit"] or dependencies["users"]["malformed"]:
        blockers.append("schedule_plan_user_defaults")
    if any(r["externally_referenced"] for r in report_rows):
        blockers.append("schedule_plan_external_references")
    if any(r["active"] for r in report_rows):
        blockers.append("schedule_plan_active_resources")
    if any(r["state"] in {"unreadable", "unsupported", "not_observed"} for r in report_rows):
        blockers.append("schedule_plan_observation_incomplete")
    if draft["holidays"]:
        blockers.append("schedule_plan_holiday_membership_unknown")
    return {
        "capabilities": caps,
        "fingerprints": hashes,
        "candidates": candidates,
        "report": {
            "checked_at": utc_now(),
            "can_apply": False,
            "blockers": blockers,
            "resources": report_rows,
            "users": dependencies["users"],
        },
    }
