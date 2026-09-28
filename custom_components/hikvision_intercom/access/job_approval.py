"""Second-operator consent bound to individual private job rows, never a bypass flag."""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Any
from uuid import uuid4

from .models import AccessError, utc_now


def row_hash(row: dict[str, Any]) -> str:
    return sha256(
        json.dumps(
            [row["index"], row["source_line"], row["change"]],
            sort_keys=True,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()


def selected(job: dict[str, Any], action: str) -> dict[str, str]:
    return {
        str(row["index"]): row_hash(row)
        for row in job["rows"]
        if row["state"] == "pending" or (action == "retry_failed" and row["state"] == "failed")
    }


def validate(job: dict[str, Any]) -> None:
    receipt = job.get("approval")
    if receipt is None:
        return
    try:
        if not isinstance(receipt, dict) or set(receipt) != {
            "state",
            "review_id",
            "requested_at",
            "expires_at",
            "action",
            "rows",
            "approver",
        }:
            raise ValueError
        if receipt["state"] not in {"pending", "approved", "rejected"}:
            raise ValueError
        if receipt["action"] not in {"resume", "retry_failed"}:
            raise ValueError
        if not re.fullmatch(r"[a-f0-9]{32}", receipt["review_id"]):
            raise ValueError
        for key in ("requested_at", "expires_at"):
            if datetime.fromisoformat(receipt[key]).tzinfo is None:
                raise ValueError
        if not isinstance(receipt["rows"], dict) or not 1 <= len(receipt["rows"]) <= 2000:
            raise ValueError
        for index, digest in receipt["rows"].items():
            if not re.fullmatch(r"[1-9][0-9]{0,3}", index) or int(index) > len(job["rows"]):
                raise ValueError
            if not re.fullmatch(r"[a-f0-9]{64}", digest):
                raise ValueError
        approver = receipt["approver"]
        if receipt["state"] == "pending":
            if approver is not None:
                raise ValueError
        elif (
            not isinstance(approver, str)
            or not 1 <= len(approver) <= 128
            or approver == job["actor"]
        ):
            raise ValueError
    except (KeyError, TypeError, ValueError):
        raise AccessError("invalid_storage") from None


def request(job: dict[str, Any], action: str) -> None:
    if action not in {"resume", "retry_failed"} or job["state"] not in {
        "paused",
        "completed_with_errors",
    }:
        raise AccessError("job_finished")
    rows = selected(job, action)
    if not rows:
        raise AccessError("job_empty_or_too_large")
    job["approval"] = {
        "state": "pending",
        "review_id": uuid4().hex,
        "requested_at": utc_now(),
        "expires_at": (datetime.now(UTC) + timedelta(hours=24)).isoformat(),
        "action": action,
        "rows": rows,
        "approver": None,
    }


def check(
    job: dict[str, Any], *, action: str | None = None, row: dict[str, Any] | None = None
) -> str:
    receipt = job.get("approval")
    if not receipt or receipt["state"] != "approved" or receipt["approver"] == job["actor"]:
        raise AccessError("approval_required")
    if datetime.fromisoformat(receipt["expires_at"]) <= datetime.now(UTC):
        raise AccessError("approval_expired")
    if action is not None:
        rows = selected(job, action)
        if (receipt["action"] != action and action != "resume") or any(
            receipt["rows"].get(index) != digest for index, digest in rows.items()
        ):
            raise AccessError("bulk_review_stale")
    if row is not None and receipt["rows"].get(str(row["index"])) != row_hash(row):
        raise AccessError("bulk_review_stale")
    return str(receipt["approver"])
