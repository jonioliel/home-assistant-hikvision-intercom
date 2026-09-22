"""Read-only, paginated projection of durable access operations."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any

from .models import AccessError, text_field
from .sync_tracking import public as public_sync

KINDS = frozenset({"all", "sync", "bulk", "csv"})
STATES = frozenset({"all", "pending", "failed", "verified", "settled", "saved"})


def _instant(value: str | None) -> float:
    if value is None:
        return 0
    try:
        return datetime.fromisoformat(value).timestamp()
    except (TypeError, ValueError, OverflowError):
        return 0


def _receipt_row(receipt: dict[str, Any], sync: list[dict[str, Any]]) -> dict[str, Any]:
    saved = receipt["saved_at"]
    users = set(receipt["user_ids"])
    stations = set(receipt["stations"])
    children = [
        item
        for item in sync
        if item["user_id"] in users
        and item["station_id"] in stations
        and _instant(item["updated_at"]) >= _instant(saved)
    ]
    counts = {
        state: sum(item["state"] == state for item in children)
        for state in ("pending", "failed", "verified", "settled")
    }
    if counts["failed"]:
        state = "failed"
    elif counts["pending"]:
        state = "pending"
    elif children and counts["verified"] == len(children):
        state = "verified"
    elif children:
        state = "settled"
    else:
        state = "saved"
    kind = "csv" if receipt["action"] == "bulk/csv_import" else "bulk"
    return {
        "id": receipt["operation_id"],
        "kind": kind,
        "action": receipt["action"],
        "state": state,
        "created_at": saved,
        "updated_at": max((item["updated_at"] for item in children), default=saved),
        "changed": receipt["changed"],
        "user_ids": list(receipt["user_ids"]),
        "station_ids": list(receipt["stations"]),
        "progress": {"total": len(children), **counts},
        "children": children[:200],
    }


def query(
    state: dict[str, Any],
    actor: str,
    *,
    filters: dict[str, Any],
    offset: int,
    limit: int,
    snapshot: str,
) -> dict[str, Any]:
    """Return operation groups without credentials or other actors' receipts."""

    text_field(actor, 128)
    if (
        not isinstance(filters, dict)
        or set(filters) - {"kind", "state", "user_id", "station_id", "query"}
        or type(offset) is not int
        or type(limit) is not int
        or not 0 <= offset
        or not 1 <= limit <= 200
        or not isinstance(snapshot, str)
        or len(snapshot) > 128
    ):
        raise AccessError("invalid_fields")
    kind = filters.get("kind", "all")
    status = filters.get("state", "all")
    if kind not in KINDS or status not in STATES:
        raise AccessError("invalid_fields")
    for key in ("user_id", "station_id"):
        if key in filters:
            text_field(filters[key], 128, empty=True)
    search = filters.get("query", "")
    if not isinstance(search, str) or len(search) > 128:
        raise AccessError("invalid_fields")
    search = search.strip().casefold()

    sync = public_sync(state)
    rows = [
        {
            "id": item["id"],
            "kind": "sync",
            "action": "sync/user_station",
            "state": item["state"],
            "created_at": item["queued_at"],
            "updated_at": item["updated_at"],
            "changed": 1,
            "user_ids": [item["user_id"]],
            "station_ids": [item["station_id"]],
            "progress": {
                "total": 1,
                "pending": int(item["state"] == "pending"),
                "failed": int(item["state"] == "failed"),
                "verified": int(item["state"] == "verified"),
                "settled": int(item["state"] == "settled"),
            },
            "children": [item],
        }
        for item in sync
    ]
    rows.extend(
        _receipt_row(receipt, sync)
        for receipt in state["operation_receipts"].values()
        if receipt["actor"] == actor
    )

    def matches(row: dict[str, Any]) -> bool:
        if kind != "all" and row["kind"] != kind:
            return False
        if status != "all" and row["state"] != status:
            return False
        if filters.get("user_id") and filters["user_id"] not in row["user_ids"]:
            return False
        if filters.get("station_id") and filters["station_id"] not in row["station_ids"]:
            return False
        if (
            search
            and search
            not in " ".join(
                [row["id"], row["action"], *row["user_ids"], *row["station_ids"]]
            ).casefold()
        ):
            return False
        return True

    rows = sorted(
        (row for row in rows if matches(row)),
        key=lambda row: (_instant(row["updated_at"]), row["id"]),
        reverse=True,
    )
    current = hashlib.sha256(
        json.dumps(
            [(row["id"], row["state"], row["updated_at"]) for row in rows],
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    total = len(rows)
    offset = min(offset, ((total - 1) // limit) * limit if total else 0)
    page = rows[offset : offset + limit]
    return {
        "records": page,
        "total": total,
        "offset": offset,
        "limit": limit,
        "next_offset": offset + limit if offset + limit < total else None,
        "previous_offset": max(0, offset - limit) if offset else None,
        "snapshot": current,
        "stale": bool(snapshot and snapshot != current),
        "summary": {
            value: sum(row["state"] == value for row in rows)
            for value in ("pending", "failed", "verified", "settled", "saved")
        },
    }
