"""Read-only, anonymous dependency audit. Empty RightPlan has unknown semantics."""

from __future__ import annotations

import asyncio
from typing import Any

from ..access.diagnostics import error_code
from ..access.models import utc_now
from ..exceptions import HikvisionError, HikvisionValidationError
from .access import AccessClient
from .client import HikvisionClient
from .schedule_inventory import inspect_inventory, integer


def user_references(users: list[dict[str, Any]]) -> dict[str, Any]:
    """Project only explicit documented RightPlan references; never export users."""
    references: set[int] = set()
    explicit = implicit = malformed = 0
    for user in users:
        plans = user.get("RightPlan")
        if plans is None or plans == []:
            implicit += 1
            continue
        try:
            if not isinstance(plans, list) or len(plans) > 128:
                raise HikvisionValidationError("Invalid user schedule references")
            per_user: set[int] = set()
            doors: set[int] = set()
            for plan in plans:
                if not isinstance(plan, dict):
                    raise HikvisionValidationError("Invalid user schedule references")
                door = integer(plan.get("doorNo"), 1, 128)
                raw = plan.get("planTemplateNo")
                if door in doors or not isinstance(raw, str) or not 1 <= len(raw) <= 1535:
                    raise HikvisionValidationError("Invalid user schedule references")
                doors.add(door)
                parts = raw.split(",")
                if len(parts) > 256 or any(
                    not 1 <= len(p) <= 5 or not p.isascii() or not p.isdecimal() for p in parts
                ):
                    raise HikvisionValidationError("Invalid user schedule references")
                ids = [integer(int(p), 1, 65535) for p in parts]
                if len(set(ids)) != len(ids):
                    raise HikvisionValidationError("Duplicate user schedule references")
                per_user.update(ids)
            references.update(per_user)
            explicit += 1
        except HikvisionValidationError:
            # A malformed user's partially parsed references are not reliable.
            malformed += 1
    return {
        "read": len(users),
        "explicit": explicit,
        "implicit": implicit,
        "malformed": malformed,
        "references": references,
    }


def summarize(
    users: dict[str, Any], inventory: dict[str, Any], rows: dict[str, list[dict[str, Any]]]
) -> dict[str, Any]:
    needed: dict[str, set[int]] = {
        "template": set(users["references"]),
        "weekly": set(),
        "holiday_group": set(),
        "holiday": set(),
    }
    checks: list[dict[str, Any]] = []
    for kind in needed:
        observed = {r["id"]: r for r in rows.get(kind, [])}
        refs = needed[kind]
        found = refs.intersection(observed)
        for key in found:
            row = observed[key]
            if kind == "template":
                needed["weekly"].add(row["week"])
                needed["holiday_group"].update(row["references"])
            elif kind == "holiday_group":
                needed["holiday"].update(row["references"])
        coverage = next(c["state"] for c in inventory["checks"] if c["kind"] == kind)
        checks.append(
            {
                "kind": kind,
                "coverage": coverage,
                "referenced": len(refs),
                "observed": len(found),
                "not_observed": len(refs - found),
                "disabled": sum(not observed[i]["enabled"] for i in found),
                "ids": sorted(refs)[:20],
                "not_observed_ids": sorted(refs - found)[:20],
            }
        )
    checked = users["state"] == "complete"
    complete = (
        checked
        and not users["implicit"]
        and not users["malformed"]
        and all(c["coverage"] == "complete" and not c["not_observed"] for c in checks)
    )
    if not checked:
        for item in checks:
            for field in ("referenced", "observed", "not_observed", "disabled"):
                item[field] = None
        users = {**users, "explicit": None, "implicit": None, "malformed": None}
    return {
        "checked_at": utc_now(),
        "users_checked": checked,
        "mapping_complete": complete,
        "can_apply": False,
        "ownership_checked": False,
        "users": {k: v for k, v in users.items() if k != "references"},
        "checks": checks,
    }


async def inspect_dependencies(client: HikvisionClient) -> dict[str, Any]:
    """Use existing verified schedule and user Search contracts with separate deadlines."""
    rows: dict[str, list[dict[str, Any]]] = {}
    inventory = await inspect_inventory(client, projected=rows)
    users: dict[str, Any] = {
        "state": "failed",
        "error": None,
        "read": None,
        "explicit": 0,
        "implicit": 0,
        "malformed": 0,
        "references": set(),
    }
    reader = HikvisionClient(
        client._session, client.settings, expected_identity=client._expected_identity
    )
    try:
        async with asyncio.timeout(60):
            await reader.async_confirm_identity()
            access = AccessClient(reader)
            await access.async_capabilities()
            users.update(user_references(await access._search("UserInfo")), state="complete")
    except (HikvisionError, TimeoutError) as err:
        users["error"] = "connection_failed" if isinstance(err, TimeoutError) else error_code(err)
    return summarize(users, inventory, rows)
