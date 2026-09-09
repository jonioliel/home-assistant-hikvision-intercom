"""Read schedule search pages observed on the commissioned firmware's web client.

POST /Search is a read operation. Disabled records are never considered free slots.
The search query's enable=False is not assumed to filter disabled records: a live
holiday-group response includes enable=True. No writer or allocation lives here.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from typing import Any
from uuid import uuid4

from ..access.diagnostics import error_code
from ..access.models import utc_now
from ..exceptions import (
    HikvisionAuthError,
    HikvisionConnectionError,
    HikvisionError,
    HikvisionTimeoutError,
    HikvisionValidationError,
)
from .client import HikvisionClient
from .parser import find_values, parse_payload
from .schedules import ROUTES, capability

SEARCH = {
    "template": ("isSupportSearchUserRightPlanTemplate", "planTemplateID"),
    "weekly": ("isSupportSearchUserRightWeekPlan", "weekPlanID"),
    "holiday_group": ("isSupportSearchUserRightHolidayGroup", "holidayGroupID"),
    "holiday": ("isSupportSearchUserRightHolidayPlan", "holidayPlanID"),
}


def integer(value: Any, low: int, high: int) -> int:
    if type(value) is not int or not low <= value <= high:
        raise HikvisionValidationError("Invalid schedule search integer")
    return int(value)


def limits(value: Any, *, ceiling: int) -> tuple[int, int]:
    if not isinstance(value, dict):
        raise HikvisionValidationError("Missing schedule search limits")
    low = integer(value.get("@min"), 0, ceiling)
    return low, integer(value.get("@max"), low, ceiling)


def search_capability(data: dict[str, Any]) -> dict[str, Any]:
    token = limits(data.get("searchID"), ceiling=128)
    position = limits(data.get("searchResultPosition"), ceiling=65535)
    page = limits(data.get("maxResults"), ceiling=1000)
    enabled = data.get("enable")
    if (
        not token[0] <= 32 <= token[1]
        or position[0] not in (0, 1)
        or not 1 <= page[0] <= min(50, page[1])
        or not isinstance(enabled, dict)
        or not isinstance(enabled.get("@opt"), list)
        or not any(v is False for v in enabled["@opt"])
    ):
        raise HikvisionValidationError("Unsupported schedule search contract")
    return {"start": position[0], "last_start": position[1], "page_size": min(50, page[1])}


def project_row(row: Any, kind: str, id_key: str, ids: list[int]) -> dict[str, Any]:
    if not isinstance(row, dict) or type(row.get("enable")) is not bool:
        raise HikvisionValidationError("Invalid schedule search record")
    result: dict[str, Any] = {
        "id": integer(row.get(id_key), ids[0], ids[1]),
        "enabled": row["enable"],
        "references": [],
    }
    reference = "holidayGroupNo" if kind == "template" else "holidayPlanNo"
    if kind in {"template", "holiday_group"}:
        text = row.get(reference)
        if not isinstance(text, str) or len(text) > 8192:
            raise HikvisionValidationError("Invalid schedule references")
        if text:
            parts = text.split(",")
            if len(parts) > 1024 or any(
                not 1 <= len(p) <= 5 or not p.isascii() or not p.isdecimal() for p in parts
            ):
                raise HikvisionValidationError("Invalid schedule references")
            values = [integer(int(p), 1, 65535) for p in parts]
            if len(set(values)) != len(values):
                raise HikvisionValidationError("Duplicate schedule references")
            result["references"] = values
        if kind == "template":
            result["week"] = integer(row.get("weekPlanNo"), 1, 65535)
    # Window/date contents remain private and are not used to claim edit/readback support.
    return result


async def search_records(
    client: HikvisionClient,
    root: str,
    kind: str,
    cap: dict[str, Any],
    search: dict[str, Any],
    progress: dict[str, Any],
    fingerprints: dict[str, str] | None = None,
    fingerprint: Callable[[Any], str] | None = None,
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    seen: set[int] = set()
    total: int | None = None
    position = search["start"]
    search_id = uuid4().hex
    for _ in range(32):
        if position > search["last_start"]:
            progress.update(state="partial", error="schedule_search_bound")
            return records
        query = {
            "searchID": search_id,
            "searchResultPosition": position,
            "maxResults": search["page_size"],
            "enable": False,
        }
        payload = parse_payload(
            await client._request(
                "POST",
                f"/ISAPI/AccessControl/{root}/Search?format=json",
                content=json.dumps(query).encode(),
                content_type="application/json",
            )
        ).data
        if "searchID" in payload and payload["searchID"] != search_id:
            raise HikvisionValidationError("Schedule search identity changed")
        current_total = integer(
            payload.get("totalMatches"), 0, min(4096, cap["ids"][1] - cap["ids"][0] + 1)
        )
        count = integer(payload.get("numOfMatches"), 0, search["page_size"])
        rows = payload.get("matchResults")
        status = payload.get("responseStatus")
        if (
            not isinstance(rows, list)
            or len(rows) != count
            or not isinstance(status, str)
            or status not in {"OK", "MORE", "NO MATCH"}
            or (total is not None and total != current_total)
        ):
            raise HikvisionValidationError("Inconsistent schedule search page")
        total = current_total
        projected = [project_row(row, kind, SEARCH[kind][1], cap["ids"]) for row in rows]
        identifiers = [r["id"] for r in projected]
        if len(set(identifiers)) != len(identifiers) or seen.intersection(identifiers):
            raise HikvisionValidationError("Repeated schedule search records")
        final = len(records) + count
        if final > total or (status == "MORE" and (count == 0 or final >= total)):
            raise HikvisionValidationError("Schedule search did not progress")
        if status == "NO MATCH" and (records or total or count):
            raise HikvisionValidationError("Invalid empty schedule search")
        if status == "OK" and final != total:
            raise HikvisionValidationError("Schedule search ended early")
        if fingerprints is not None and fingerprint is not None:
            try:
                captured = {
                    str(identifier): fingerprint(row)
                    for identifier, row in zip(identifiers, rows, strict=True)
                }
            except (ValueError, TypeError, RecursionError):
                raise HikvisionValidationError("Invalid schedule fingerprint input") from None
            fingerprints.update(captured)
        records.extend(projected)
        seen.update(identifiers)
        progress.update(total=total, read=final, pages=progress["pages"] + 1)
        if status in {"OK", "NO MATCH"}:
            progress.update(state="complete", error=None)
            return records
        position += count
    progress.update(state="partial", error="schedule_search_bound")
    return records


async def inspect_inventory(
    client: HikvisionClient,
    *,
    projected: dict[str, list[dict[str, Any]]] | None = None,
    evidence: dict[str, Any] | None = None,
    fingerprint: Callable[[Any], str] | None = None,
) -> dict[str, Any]:
    """Return an allowlisted summary, isolated from the normal call/release I/O lock."""
    reader = HikvisionClient(
        client._session, client.settings, expected_identity=client._expected_identity
    )
    checks: list[dict[str, Any]] = [
        {
            "kind": kind,
            "state": "not_checked",
            "error": None,
            "capabilities": None,
            "search": None,
            "read": 0,
            "total": None,
            "pages": 0,
            "enabled": None,
            "disabled": None,
            "referenced": None,
        }
        for kind, *_ in ROUTES
    ]
    inventories: dict[str, list[dict[str, Any]]] = {}
    captured_rows: dict[str, dict[str, str]] = {kind: {} for kind, *_ in ROUTES}
    captured_capabilities: dict[str, str] = {}
    try:
        async with asyncio.timeout(60):
            await reader.async_confirm_identity()
            flags = await reader._get("/ISAPI/AccessControl/capabilities")
            for item, (kind, root, flag, selector) in zip(checks, ROUTES, strict=True):
                supported = [find_values(flags, f) for f in (flag, SEARCH[kind][0])]
                if not all(len(v) == 1 and (v[0] is True or v[0] == "true") for v in supported):
                    item.update(state="unsupported", error="operation_unsupported")
                    continue
                try:
                    raw_cap = await reader._get(
                        f"/ISAPI/AccessControl/{root}/capabilities?format=json"
                    )
                    cap = capability(raw_cap, root, selector)
                    if kind == "weekly":
                        week_node = raw_cap[root]["WeekPlanCfg"].get("week")
                        weekdays = week_node.get("@opt") if isinstance(week_node, dict) else None
                        if isinstance(weekdays, str):
                            weekdays = weekdays.split(",")
                        from ..access.schedules import DAYS

                        if not isinstance(weekdays, list) or not all(d in DAYS for d in weekdays):
                            raise HikvisionValidationError("Missing supported weekdays")
                        cap["weekdays"] = weekdays
                    raw_search = await reader._get(
                        f"/ISAPI/AccessControl/{root}/Search/capabilities?format=json"
                    )
                    search = search_capability(raw_search)
                    if fingerprint is not None:
                        try:
                            captured_capabilities[kind] = fingerprint([raw_cap, raw_search])
                        except (ValueError, TypeError, RecursionError):
                            raise HikvisionValidationError(
                                "Invalid schedule fingerprint input"
                            ) from None
                    item.update(capabilities=cap, search=search)
                    rows = await search_records(
                        reader, root, kind, cap, search, item, captured_rows[kind], fingerprint
                    )
                    inventories[kind] = rows
                    item.update(
                        enabled=sum(r["enabled"] for r in rows),
                        disabled=sum(not r["enabled"] for r in rows),
                    )
                except (HikvisionAuthError, HikvisionConnectionError, HikvisionTimeoutError):
                    raise
                except HikvisionValidationError:
                    item.update(
                        state="failed",
                        error="schedule_inventory_invalid",
                        enabled=None,
                        disabled=None,
                    )
                except HikvisionError as err:
                    item.update(state="failed", error=error_code(err))
            # Count referenced IDs among rows actually read, including references from disabled
            # records. This is not an inventory of user assignments or a claim of slot ownership.
            refs = {
                "weekly": {r["week"] for r in inventories.get("template", [])},
                "holiday_group": {
                    i for r in inventories.get("template", []) for i in r["references"]
                },
                "holiday": {
                    i for r in inventories.get("holiday_group", []) for i in r["references"]
                },
            }
            sources = {
                "weekly": "template",
                "holiday_group": "template",
                "holiday": "holiday_group",
            }
            for item in checks:
                if (
                    item["kind"] in refs
                    and item["kind"] in inventories
                    and sources[item["kind"]] in inventories
                ):
                    item["referenced"] = len(
                        refs[item["kind"]].intersection(r["id"] for r in inventories[item["kind"]])
                    )
    except (HikvisionError, TimeoutError) as err:
        for item in checks:
            if item["state"] == "not_checked":
                item.update(
                    state="failed",
                    error="connection_failed" if isinstance(err, TimeoutError) else error_code(err),
                )
    if projected is not None:
        projected.clear()
        projected.update(inventories)
    if evidence is not None:
        evidence.clear()
        evidence.update(
            {
                item["kind"]: {
                    "state": item["state"],
                    "total": item["total"],
                    "rows": captured_rows[item["kind"]]
                    if item["state"] in {"complete", "partial"}
                    else {},
                    "capability": captured_capabilities.get(item["kind"]),
                }
                for item in checks
            }
        )
    return {
        "checked_at": utc_now(),
        "checks": checks,
        "complete": all(i["state"] == "complete" for i in checks),
        "can_apply": False,
        "ownership_checked": False,
        "users_checked": False,
    }
