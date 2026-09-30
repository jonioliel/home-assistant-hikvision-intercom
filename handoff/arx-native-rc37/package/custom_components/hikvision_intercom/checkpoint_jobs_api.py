"""Explicit administrator previews become resumable jobs; no automatic start."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from typing import Any

from homeassistant.core import HomeAssistant

from .access.models import AccessError
from .access_runtime import get_manager
from .const import DOMAIN


async def dispatch_jobs(
    hass: HomeAssistant, command: str, msg: dict[str, Any], actor: str, user: Any
) -> Any:
    if not actor or not user or not user.is_active or not user.is_admin:
        raise AccessError("unauthorized")
    jobs = hass.data[DOMAIN].get("checkpoint_jobs")
    if jobs is None:
        raise AccessError("jobs_unavailable")
    manager = get_manager(hass)
    if command == "jobs/list":
        return {
            "records": jobs.records(actor),
            "reviews": jobs.pending_reviews(actor),
            "dual_approval": hass.data[DOMAIN]["workflows"].settings()["dual_approval"],
        }
    if command == "jobs/approval_review":
        return jobs.approval_review(actor, msg["job_id"])
    if command in {"jobs/approval_request", "jobs/approval_decide"}:
        if msg.get("confirmed") is not True:
            raise AccessError("confirmation_required")
        if command == "jobs/approval_request":
            return await jobs.approval_request(actor, msg["job_id"], msg["revision"], msg["action"])
        return await jobs.approval_decide(
            actor, msg["job_id"], msg["revision"], msg["review_id"], msg["approve"]
        )
    if command == "jobs/errors":
        return {"csv": jobs.error_csv(actor, msg["job_id"])}
    if command == "jobs/action":
        return await jobs.action(actor, msg["job_id"], msg["revision"], msg["action"])
    if msg.get("confirmed") is not True:
        raise AccessError("confirmation_required")
    if command == "jobs/bulk_create":
        existing = jobs.find(actor, "bulk", msg["operation_id"])
        if existing:
            return existing
        manager.bulk._purge()
        review = manager.bulk.reviews.get(msg["operation_id"])
        if not review or review["actor"] != actor:
            raise AccessError("bulk_review_expired")
        if review["rules"] != manager.bulk.rules_stamp():
            raise AccessError("bulk_review_stale")
        result = await jobs.create(
            actor,
            "bulk",
            deepcopy(review["changes"]),
            stamp=review["stamp"],
            rules=review["rules"],
            request_key=msg["operation_id"],
        )
        manager.bulk.reviews.pop(msg["operation_id"], None)
        return result
    if command == "jobs/csv_create":
        existing = jobs.find(actor, "csv", msg["review_token"])
        if existing:
            return existing
        rules = manager._csv_rules()
        preview, changes, stamp = await asyncio.to_thread(
            manager._bulk_preview,
            msg["content"],
            msg["mode"],
            manager.repository.preview_copy(),
            rules,
            msg.get("column_map"),
        )
        if preview["errors"]:
            raise AccessError("csv_validation_failed")
        if not msg["review_token"] or preview["review_token"] != msg["review_token"]:
            raise AccessError("csv_review_stale")
        if rules != manager._csv_rules():
            raise AccessError("bulk_review_stale")
        return await jobs.create(
            actor,
            "csv",
            changes,
            stamp=stamp,
            rules=manager.bulk.rules_stamp(),
            request_key=msg["review_token"],
            source_lines=[
                row["line"] for row in preview["rows"] if row["operation"] != "unchanged"
            ],
        )
    raise AccessError("unknown_command")
