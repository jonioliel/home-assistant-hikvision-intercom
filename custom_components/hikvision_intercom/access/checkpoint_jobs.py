"""Operator-started row jobs with progress committed beside each desired change.

Stopping affects unsaved rows only. Saved access changes keep reconciling; cancellation
never grants access back or pretends to undo an already committed operation.
"""

from __future__ import annotations

import asyncio
import csv
import io
import re
from collections.abc import Awaitable, Callable
from copy import deepcopy
from datetime import datetime
from hashlib import sha256
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from . import job_approval
from .admin_audit import audit_actor
from .csv_transfer import desired_fields, validate_csv_targets
from .models import AccessError, utc_now

if TYPE_CHECKING:
    from .manager import AccessManager

STATES = {"paused", "running", "completed", "completed_with_errors", "cancelled"}
ROW_STATES = {"pending", "saved", "failed"}


def validate(data: Any) -> None:
    try:
        if not isinstance(data, dict) or len(data) > 100:
            raise ValueError
        if sum(len(job.get("rows", [])) for job in data.values()) > 5000:
            raise ValueError
        for identity, job in data.items():
            if not isinstance(job, dict) or set(job) - {"approval"} != {
                "id",
                "actor",
                "kind",
                "state",
                "revision",
                "created_at",
                "updated_at",
                "rules",
                "rows",
            }:
                raise ValueError
            job_approval.validate(job)
            if identity != job["id"] or not re.fullmatch(r"[0-9a-f]{32}", identity):
                raise ValueError
            if job["kind"] not in {"csv", "bulk"} or job["state"] not in STATES:
                raise ValueError
            if type(job["revision"]) is not int or job["revision"] < 1:
                raise ValueError
            if not isinstance(job["actor"], str) or not 1 <= len(job["actor"]) <= 128:
                raise ValueError
            if not isinstance(job["rows"], list) or not 1 <= len(job["rows"]) <= 2000:
                raise ValueError
            if not isinstance(job["rules"], str) or not 1 <= len(job["rules"]) <= 128:
                raise ValueError
            for key in ("created_at", "updated_at"):
                if datetime.fromisoformat(job[key]).tzinfo is None:
                    raise ValueError
            for index, row in enumerate(job["rows"]):
                if not isinstance(row, dict) or set(row) != {
                    "index",
                    "state",
                    "error",
                    "change",
                    "source_line",
                }:
                    raise ValueError
                if type(row["index"]) is not int or row["index"] != index + 1:
                    raise ValueError
                if type(row["source_line"]) is not int or not 1 <= row["source_line"] <= 10000:
                    raise ValueError
                if row["error"] is not None and (
                    not isinstance(row["error"], str)
                    or not re.fullmatch(r"[a-z_]{1,64}", row["error"])
                ):
                    raise ValueError
                if row["state"] not in ROW_STATES or not isinstance(row["change"], dict):
                    raise ValueError
                change = row["change"]
                if (
                    row["state"] != "saved"
                    and job["state"] != "cancelled"
                    and (
                        not {"user_id", "revision", "data"} <= set(change)
                        or set(change) - {"user_id", "revision", "data", "delete"}
                        or not isinstance(change["data"], dict)
                    )
                ):
                    raise ValueError
                if change:
                    uid, revision = change["user_id"], change["revision"]
                    if uid is not None and (not isinstance(uid, str) or not 1 <= len(uid) <= 64):
                        raise ValueError
                    if uid is not None and (type(revision) is not int or revision < 1):
                        raise ValueError
                    if uid is None and revision is not None:
                        raise ValueError
                    if "delete" in change and type(change["delete"]) is not bool:
                        raise ValueError
            if job["state"] == "running":
                # A restart always requires an operator to inspect and resume.
                job["state"] = "paused"
    except (KeyError, TypeError, ValueError):
        raise AccessError("invalid_storage") from None


class CheckpointJobs:
    def __init__(self, manager: AccessManager, authorize: Callable[[str], Awaitable[bool]]) -> None:
        self.manager = manager
        self.authorize = authorize
        self.tasks: dict[str, asyncio.Task[None]] = {}
        self.closed = False
        self._workers = asyncio.Semaphore(2)

    def records(self, actor: str) -> list[dict[str, Any]]:
        return [
            self.public(job)
            for job in sorted(
                self.manager.repository._state["checkpoint_jobs"].values(),
                key=lambda item: item["created_at"],
                reverse=True,
            )
            if job["actor"] == actor
        ]

    @staticmethod
    def public(job: dict[str, Any]) -> dict[str, Any]:
        return {
            key: deepcopy(job[key])
            for key in ("id", "kind", "state", "revision", "created_at", "updated_at")
        } | {
            "approval": (
                {key: job["approval"][key] for key in ("state", "action", "expires_at")}
                if job.get("approval")
                else None
            ),
            "total": len(job["rows"]),
            "saved": sum(row["state"] == "saved" for row in job["rows"]),
            "failed": sum(row["state"] == "failed" for row in job["rows"]),
            "pending": sum(row["state"] == "pending" for row in job["rows"]),
            "errors": [
                {"row": row["source_line"], "code": row["error"]}
                for row in job["rows"]
                if row["state"] == "failed"
            ],
        }

    def pending_reviews(self, actor: str) -> list[dict[str, Any]]:
        return [
            self.public(job)
            for job in self.manager.repository._state["checkpoint_jobs"].values()
            if job["actor"] != actor
            and (job.get("approval") or {}).get("state") == "pending"
            and job["state"] in {"paused", "completed_with_errors"}
        ]

    def approval_review(self, actor: str, identity: str) -> dict[str, Any]:
        from .admin_audit import summary

        def evidence(raw: dict[str, Any] | None) -> dict[str, Any] | None:
            if raw is None:
                return None
            policy = raw.get("access_timing_policy")
            return {
                **(summary(raw) or {}),
                "timing": (
                    {"mode": policy["mode"], "schedule": deepcopy(policy["schedule"])}
                    if policy
                    else None
                ),
            }

        job = self.manager.repository._state["checkpoint_jobs"].get(identity)
        if not job or not job.get("approval"):
            raise AccessError("operation_not_found")
        receipt = job["approval"]
        if receipt["state"] != "pending" or job["state"] not in {"paused", "completed_with_errors"}:
            raise AccessError("operation_not_found")
        if selected := job_approval.selected(job, receipt["action"]):
            if selected != receipt["rows"]:
                raise AccessError("bulk_review_stale")
        else:
            raise AccessError("bulk_review_stale")
        changes = [row["change"] for row in job["rows"] if str(row["index"]) in selected]
        from .workflows import Workflows

        state = self.manager.repository._state
        candidate = Workflows(self.manager)._preview(state, changes)
        added = iter(raw for uid, raw in candidate["users"].items() if uid not in state["users"])
        return {
            **self.public(job),
            "review_id": receipt["review_id"],
            "own_request": actor == job["actor"],
            "impact": [
                {
                    "before": evidence(state["users"].get(change["user_id"])),
                    "after": evidence(candidate["users"].get(change["user_id"]))
                    if change["user_id"]
                    else evidence(next(added)),
                    "fields": sorted(change["data"]),
                    "delete": bool(change.get("delete")),
                }
                for change in changes
            ],
        }

    async def approval_request(
        self, actor: str, identity: str, revision: int, action: str
    ) -> dict[str, Any]:
        if self.closed or not await self.authorize(actor):
            raise AccessError("unauthorized")

        def apply(state: dict[str, Any]) -> dict[str, Any]:
            job = state["checkpoint_jobs"].get(identity)
            if not job or job["actor"] != actor:
                raise AccessError("operation_not_found")
            if type(revision) is not int or job["revision"] != revision:
                raise AccessError("revision_conflict")
            if job["rules"] != self.manager.bulk.rules_stamp():
                raise AccessError("bulk_review_stale")
            job_approval.request(job, action)
            job["revision"] += 1
            job["updated_at"] = utc_now()
            return self.public(job)

        result = await self.manager.repository._commit(apply)
        self.manager._changed()
        return result

    async def approval_decide(
        self, actor: str, identity: str, revision: int, review_id: str, approve: bool
    ) -> dict[str, Any]:
        if self.closed or not await self.authorize(actor):
            raise AccessError("unauthorized")

        def apply(state: dict[str, Any]) -> dict[str, Any]:
            job = state["checkpoint_jobs"].get(identity)
            if not job or not job.get("approval"):
                raise AccessError("operation_not_found")
            if actor == job["actor"]:
                raise AccessError("separate_approver_required")
            if type(revision) is not int or job["revision"] != revision:
                raise AccessError("revision_conflict")
            receipt = job["approval"]
            if receipt["state"] != "pending" or receipt["review_id"] != review_id:
                raise AccessError("bulk_review_stale")
            if datetime.fromisoformat(receipt["expires_at"]) <= datetime.now().astimezone():
                raise AccessError("approval_expired")
            if (
                job["rules"] != self.manager.bulk.rules_stamp()
                or job_approval.selected(job, receipt["action"]) != receipt["rows"]
            ):
                raise AccessError("bulk_review_stale")
            # Rebuild the masked impact; changed people invalidate this review.
            self.approval_review(actor, identity)
            receipt.update(state="approved" if approve else "rejected", approver=actor)
            job["revision"] += 1
            job["updated_at"] = utc_now()
            return self.public(job)

        result = await self.manager.repository._commit(apply, offload=True)
        self.manager._changed()
        return result

    async def create(
        self,
        actor: str,
        kind: str,
        changes: list[dict[str, Any]],
        *,
        stamp: str,
        rules: str,
        request_key: str = "",
        source_lines: list[int] | None = None,
    ) -> dict[str, Any]:
        if kind not in {"csv", "bulk"} or not 1 <= len(changes) <= 2000:
            raise AccessError("job_empty_or_too_large")
        if self.closed or not await self.authorize(actor):
            raise AccessError("unauthorized")
        identity = self.identity(actor, kind, request_key) if request_key else uuid4().hex
        existing = self.find(actor, kind, request_key) if request_key else None
        if existing:
            return existing
        now = utc_now()
        if source_lines is not None and len(source_lines) != len(changes):
            raise AccessError("invalid_fields")
        job = {
            "id": identity,
            "actor": actor,
            "kind": kind,
            "state": "paused",
            "revision": 1,
            "created_at": now,
            "updated_at": now,
            "rules": rules,
            "rows": [
                {
                    "index": index + 1,
                    "state": "pending",
                    "error": None,
                    "change": deepcopy(change),
                    "source_line": source_lines[index] if source_lines else index + 1,
                }
                for index, change in enumerate(changes)
            ],
        }

        def apply(state: dict[str, Any]) -> dict[str, Any]:
            if identity in state["checkpoint_jobs"]:
                return self.public(state["checkpoint_jobs"][identity])
            if (
                sum(len(item["rows"]) for item in state["checkpoint_jobs"].values()) + len(changes)
                > 5000
            ):
                raise AccessError("job_limit")
            if stamp != self.manager.repository.bulk_stamp(state):
                raise AccessError("bulk_review_stale")
            jobs = state["checkpoint_jobs"]
            if len(jobs) >= 100:
                finished = [
                    item
                    for item in jobs.values()
                    if item["state"].startswith("completed") or item["state"] == "cancelled"
                ]
                if not finished:
                    raise AccessError("job_limit")
                del jobs[min(finished, key=lambda item: item["created_at"])["id"]]
            jobs[identity] = job
            return self.public(job)

        result = await self.manager.repository._commit(apply)
        self.manager._changed()
        return result

    @staticmethod
    def identity(actor: str, kind: str, key: str) -> str:
        return sha256(f"{actor}:{kind}:{key}".encode()).hexdigest()[:32]

    def find(self, actor: str, kind: str, key: str) -> dict[str, Any] | None:
        job = self.manager.repository._state["checkpoint_jobs"].get(self.identity(actor, kind, key))
        return self.public(job) if job and job["actor"] == actor else None

    async def action(self, actor: str, identity: str, revision: int, action: str) -> dict[str, Any]:
        if action not in {"pause", "resume", "cancel", "retry_failed"}:
            raise AccessError("invalid_fields")
        if self.closed or (
            action in {"resume", "retry_failed"} and not await self.authorize(actor)
        ):
            raise AccessError("unauthorized")
        observed = self.manager.repository._state["checkpoint_jobs"].get(identity)
        if (
            action in {"resume", "retry_failed"}
            and observed
            and observed["actor"] == actor
            and self.manager.repository._state["workflows"]["settings"]["dual_approval"]
        ):
            approver = job_approval.check(observed, action=action)
            if not await self.authorize(approver):
                raise AccessError("approval_required")

        def apply(state: dict[str, Any]) -> dict[str, Any]:
            job = state["checkpoint_jobs"].get(identity)
            if not job or job["actor"] != actor:
                raise AccessError("operation_not_found")
            if type(revision) is not int or job["revision"] != revision:
                raise AccessError("revision_conflict")
            if job["state"] == "cancelled" or job["state"] == "completed":
                raise AccessError("job_finished")
            if action in {"resume", "retry_failed"}:
                if state["workflows"]["settings"]["dual_approval"]:
                    job_approval.check(job, action=action)
                if job["rules"] != self.manager.bulk.rules_stamp():
                    raise AccessError("bulk_review_stale")
                if action == "retry_failed":
                    for row in job["rows"]:
                        if row["state"] == "failed":
                            row.update(state="pending", error=None)
                job["state"] = "running"
            elif action == "pause":
                job["state"] = "paused"
            else:
                job["state"] = "cancelled"
                job.pop("approval", None)
                for row in job["rows"]:
                    row["change"] = {}
            job["revision"] += 1
            job["updated_at"] = utc_now()
            return self.public(job)

        result = await self.manager.repository._commit(apply)
        if result["state"] == "running" and (
            identity not in self.tasks or self.tasks[identity].done()
        ):
            self.tasks[identity] = asyncio.create_task(self.run(identity))
        self.manager._changed()
        return result

    async def run(self, identity: str) -> None:
        async with self._workers:
            await self._run(identity)

    async def _run(self, identity: str) -> None:
        repository = self.manager.repository
        try:
            while not self.closed:
                job = repository._state["checkpoint_jobs"][identity]
                if job["state"] != "running":
                    return
                if not await self.authorize(job["actor"]):
                    await self._pause(identity)
                    return
                if repository._state["workflows"]["settings"]["dual_approval"]:
                    try:
                        approver = job_approval.check(job)
                        if not await self.authorize(approver):
                            raise AccessError("approval_required")
                    except AccessError:
                        await self._pause(identity)
                        return
                row = next((row for row in job["rows"] if row["state"] == "pending"), None)
                if row is None:

                    def finish(state: dict[str, Any]) -> None:
                        current = state["checkpoint_jobs"][identity]
                        if current["state"] == "running":
                            current["state"] = (
                                "completed_with_errors"
                                if any(row["state"] == "failed" for row in current["rows"])
                                else "completed"
                            )
                            current["revision"] += 1
                            current["updated_at"] = utc_now()

                    await repository._commit(finish)
                    return
                index = row["index"] - 1
                targets: set[str] = set()

                def apply(
                    state: dict[str, Any], index: int = index, targets: set[str] = targets
                ) -> None:
                    current = state["checkpoint_jobs"][identity]
                    if current["state"] != "running":
                        raise AccessError("job_paused")
                    if current["rules"] != self.manager.bulk.rules_stamp():
                        raise AccessError("bulk_review_stale")
                    record = current["rows"][index]
                    if state["workflows"]["settings"]["dual_approval"]:
                        job_approval.check(current, row=record)
                    change = record["change"]
                    uid = change["user_id"]
                    if uid:
                        old = repository.get(uid)
                        targets.update(old.assignments)
                        targets.update(
                            sid for sid, bindings in state["bindings"].items() if uid in bindings
                        )
                        for collection in ("retired_cards", "retired_pins"):
                            targets.update(
                                sid
                                for item in state[collection].values()
                                if item["user_id"] == uid
                                for sid in item["targets"]
                            )
                    if change.get("delete"):
                        repository._delete_user(state, uid, change["revision"])
                    else:
                        user = repository._bulk_users(state, [change])[0]
                        if not uid or desired_fields(old) != desired_fields(user):
                            validate_csv_targets(user, self.manager._csv_rules())
                        targets.update(user.assignments)
                    record.update(state="saved", error=None, change={})
                    current["revision"] += 1
                    current["updated_at"] = utc_now()

                try:
                    with audit_actor(job["actor"], f"job/{job['kind']}"):
                        await repository._commit(apply, offload=True)
                except AccessError as error:
                    code = str(error)
                    if code in {
                        "job_paused",
                        "bulk_review_stale",
                        "approval_required",
                        "approval_expired",
                    }:
                        await self._pause(identity)
                        return
                    safe = code if re.fullmatch(r"[a-z_]{1,64}", code) else "operation_failed"

                    def failed(state: dict[str, Any], index: int = index, safe: str = safe) -> None:
                        current = state["checkpoint_jobs"][identity]
                        if current["state"] == "cancelled":
                            return
                        current["rows"][index].update(state="failed", error=safe)
                        current["revision"] += 1
                        current["updated_at"] = utc_now()

                    await repository._commit(failed)
                finally:
                    # Include retired credentials and tombstones, even after cancellation.
                    saved_row = repository._state["checkpoint_jobs"][identity]["rows"][index]
                    if saved_row["state"] == "saved":
                        for sid in targets:
                            if sid in self.manager.stations:
                                self.manager.request(sid)
                    self.manager._changed()
                await asyncio.sleep(0)
        except asyncio.CancelledError:
            raise
        except Exception:
            # Persistence failure halts writes; do not misclassify it as a row failure.
            try:
                await self._pause(identity)
            except Exception:
                pass
        finally:
            self.manager._changed()

    async def _pause(self, identity: str) -> None:
        def apply(state: dict[str, Any]) -> None:
            job = state["checkpoint_jobs"][identity]
            if job["state"] == "running":
                job["state"] = "paused"
                job["revision"] += 1
                job["updated_at"] = utc_now()

        await self.manager.repository._commit(apply)

    def error_csv(self, actor: str, identity: str) -> str:
        job = self.manager.repository._state["checkpoint_jobs"].get(identity)
        if not job or job["actor"] != actor:
            raise AccessError("operation_not_found")
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(["row", "state", "error"])
        for row in job["rows"]:
            if row["state"] == "failed":
                writer.writerow([row["source_line"], row["state"], row["error"]])
        return out.getvalue()

    async def close(self) -> None:
        self.closed = True
        for task in self.tasks.values():
            task.cancel()
        await asyncio.gather(*self.tasks.values(), return_exceptions=True)
