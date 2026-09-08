"""Compare local drafts with advertised device limits, without allocation or writes."""

from __future__ import annotations

from typing import Any

from .schedules import DAYS, minute, normalize


def assess(draft: dict[str, Any], inventory: dict[str, Any]) -> dict[str, Any]:
    draft = normalize(draft)
    checks: list[dict[str, Any]] = []
    capabilities = {c["kind"]: c.get("capabilities") for c in inventory["checks"]}
    weekly = draft["weekly"]
    holidays = draft["holidays"]
    requirements = {
        "template": 1,
        "weekly": 1,
        "holiday_group": int(bool(holidays)),
        "holiday": len(holidays),
        "weekly_periods": sum(len(p) for p in weekly.values()),
    }

    def add(key: str, needed: int, available: int | None) -> None:
        checks.append(
            {
                "key": key,
                "needed": needed,
                "available": available,
                "state": "unknown"
                if available is None
                else "fits"
                if needed <= available
                else "exceeds",
            }
        )

    for kind in ("template", "weekly", "holiday_group", "holiday"):
        if not requirements[kind]:
            continue
        cap = capabilities.get(kind)
        add(
            kind + "_resources",
            requirements[kind],
            cap["ids"][1] - cap["ids"][0] + 1 if cap else None,
        )
    for kind, windows in (
        ("weekly", list(weekly.values())),
        ("holiday", [h["periods"] for h in holidays]),
    ):
        if kind == "holiday" and not holidays:
            continue
        cap = capabilities.get(kind)
        add(
            kind + "_per_day",
            max(map(len, windows), default=0),
            cap["period_ids"][1] - cap["period_ids"][0] + 1 if cap else None,
        )
        add(
            kind + "_periods",
            sum(map(len, windows)) if kind == "weekly" else max(map(len, windows), default=0),
            cap.get("max_periods") if cap else None,
        )
        misaligned = sum(
            minute(p[key], end=key == "end") % 60 != 0
            for periods in windows
            for p in periods
            for key in ("start", "end")
        )
        add(
            kind + "_precision",
            misaligned if cap and cap.get("precision") == "hour" else 0,
            0 if cap and cap.get("precision") in {"hour", "minute", "second"} else None,
        )
    cap = capabilities.get("weekly")
    unsupported = (
        sum(bool(weekly[d]) and d not in cap.get("weekdays", []) for d in DAYS) if cap else 0
    )
    add("weekdays", unsupported, 0 if cap and cap.get("weekdays") else None)
    if holidays:
        # Identifier ranges are not the maximum number of references per group.
        add("holiday_membership", len(holidays), None)
    return {
        "requirements": requirements,
        "limits": checks,
        "state": "exceeds"
        if any(c["state"] == "exceeds" for c in checks)
        else "unknown"
        if any(c["state"] == "unknown" for c in checks)
        else "fits",
        "can_apply": False,
        "inventory_complete": inventory["complete"],
        "blockers": ["schedule_writes_unverified", "schedule_ownership_unknown"]
        + ([] if inventory["complete"] else ["schedule_inventory_incomplete"]),
    }
