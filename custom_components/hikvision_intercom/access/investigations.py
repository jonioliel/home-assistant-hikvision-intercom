"""Read-only timeline with explicit evidence and conservative identity attribution."""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any

from .models import AccessError, text_field
from .sync_tracking import public as public_sync

SOURCES = frozenset({"all", "access", "change", "sync"})


def instant(value: Any) -> datetime | None:
    try:
        if not isinstance(value, str) or len(value) > 40:
            return None
        parsed = datetime.fromisoformat(value)
        return parsed.astimezone(UTC) if parsed.tzinfo is not None else None
    except (ValueError, OverflowError):
        return None


def query(
    state: dict[str, Any],
    events: list[dict[str, Any]],
    *,
    filters: dict[str, Any],
    offset: int,
    limit: int,
    snapshot: str,
    now: datetime,
) -> dict[str, Any]:
    """Project allowlisted fields; proximity of records never proves causation."""
    if (
        not isinstance(filters, dict)
        or set(filters) - {"source", "user_id", "station_id", "query", "start", "end"}
        or type(offset) is not int
        or not 0 <= offset <= 1_000_000
        or type(limit) is not int
        or not 1 <= limit <= 200
        or not isinstance(snapshot, str)
        or len(snapshot) > 64
        or now.tzinfo is None
    ):
        raise AccessError("invalid_fields")
    source = filters.get("source", "all")
    if not isinstance(source, str) or source not in SOURCES:
        raise AccessError("invalid_fields")
    for key in ("user_id", "station_id", "query"):
        if key in filters:
            text_field(filters[key], 128, empty=True)
    start, end = instant(filters.get("start")), instant(filters.get("end"))
    if (
        "start" in filters
        and start is None
        or "end" in filters
        and end is None
        or start
        and end
        and start >= end
    ):
        raise AccessError("invalid_fields")
    now = now.astimezone(UTC)
    cutoff = now - timedelta(days=30)
    users = state["users"]

    # Only one observed owner whose observation precedes device event time can
    # establish a link. Pending ownership, reused identifiers and received-time
    # fallback cannot establish historical identity.
    owners: dict[tuple[str, str], list[tuple[str, datetime]]] = {}
    for sid, bindings in state["bindings"].items():
        for uid, binding in bindings.items():
            raw = users.get(uid)
            observed = instant(binding.get("identity_observed_at"))
            if (
                raw
                and raw["employee_no"] == binding["employee_no"]
                and binding.get("fingerprint")
                and observed is not None
            ):
                owners.setdefault((sid, raw["employee_no"]), []).append((uid, observed))

    rows: list[dict[str, Any]] = []
    for event in events:
        when, received = instant(event.get("timestamp")), instant(event.get("received_at"))
        if when is None or received is None or received < cutoff:
            continue
        sid = event["station_id"]
        employee = event.get("employee_no")
        candidates = owners.get((sid, employee), []) if isinstance(employee, str) else []
        uid = (
            candidates[0][0]
            if len(candidates) == 1
            and candidates[0][1] <= when
            and event.get("time_source") == "device"
            else None
        )
        rows.append(
            {
                "id": "access/" + event["id"],
                "source": "access",
                "time": when.isoformat(),
                "received_at": received.isoformat(),
                "time_source": event.get("time_source", "received"),
                "user_id": uid,
                "person_name": users[uid]["display_name"] if uid else event.get("person_name"),
                "employee_no": employee,
                "station_ids": [sid],
                "action": event["event_type"],
                "status": event["result"],
                "actor": None,
                "evidence": "device_event",
                "details": {
                    "authentication": event["authentication"],
                    "door": event.get("door"),
                    "recovered": bool(event.get("recovered")),
                    "identity_basis": "observed_station_owner" if uid else "device_record_only",
                },
            }
        )
    for change in state["admin_audit"]["records"]:
        when = instant(change["time"])
        if when is None or when < cutoff:
            continue
        summary = change.get("after") or change.get("before") or {}
        rows.append(
            {
                "id": "change/" + str(change["sequence"]),
                "source": "change",
                "time": when.isoformat(),
                "received_at": None,
                "time_source": "system",
                "user_id": change["user_id"],
                "person_name": summary.get("display_name"),
                "employee_no": summary.get("employee_no"),
                "station_ids": list(change["stations"]),
                "action": change["action"],
                "status": "saved",
                "actor": change["actor"] or None,
                "evidence": "desired_state_saved",
                "details": {
                    "fields": list(change["fields"]),
                    "revision_before": change["revision_before"],
                    "revision_after": change["revision_after"],
                    "reason_code": change.get("reason_code"),
                },
            }
        )
    for item in public_sync(state):
        when = instant(item["updated_at"])
        if when is None:
            continue
        raw = users.get(item["user_id"], {})
        rows.append(
            {
                "id": "sync/" + item["id"],
                "source": "sync",
                "time": when.isoformat(),
                "received_at": None,
                "time_source": "system",
                "user_id": item["user_id"],
                "person_name": raw.get("display_name"),
                "employee_no": raw.get("employee_no"),
                "station_ids": [item["station_id"]],
                "action": "sync/user_station",
                "status": item["state"],
                "actor": None,
                "evidence": "device_readback" if item["state"] == "verified" else "sync_journal",
                "details": {"queued_at": item["queued_at"], "verified_at": item["verified_at"]},
            }
        )
    search = filters.get("query", "").strip().casefold()

    def matches(row: dict[str, Any]) -> bool:
        if source != "all" and row["source"] != source:
            return False
        if filters.get("user_id") and row["user_id"] != filters["user_id"]:
            return False
        if filters.get("station_id") and filters["station_id"] not in row["station_ids"]:
            return False
        when = instant(row["time"])
        if when is None or start and when < start or end and when > end:
            return False
        return (
            not search
            or search
            in " ".join(
                str(row.get(key) or "")
                for key in ("person_name", "employee_no", "user_id", "actor", "action", "status")
            ).casefold()
        )

    rows = sorted(
        (row for row in rows if matches(row)),
        key=lambda row: (row["time"], row["id"]),
        reverse=True,
    )
    current = hashlib.sha256(
        json.dumps(rows, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    total = len(rows)
    offset = min(offset, ((total - 1) // limit) * limit if total else 0)
    return {
        "records": rows[offset : offset + limit],
        "total": total,
        "offset": offset,
        "limit": limit,
        "next_offset": offset + limit if offset + limit < total else None,
        "previous_offset": max(0, offset - limit) if offset else None,
        "snapshot": current,
        "stale": bool(snapshot and snapshot != current),
        "summary": {
            kind: Counter(row["source"] for row in rows)[kind] for kind in SOURCES - {"all"}
        },
        "generated_at": now.isoformat(),
        "retention": {"access_days": 30, "change_days": 30, "sync": "latest_per_user_station"},
        "correlation": "chronology_is_not_causation",
    }
