"""Durable, bounded door-configuration jobs; uncertain writes are never replayed."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Any
from uuid import uuid4

from .access.diagnostics import error_code
from .access.models import AccessError
from .client.technical import FIELDS
from .operations_center import canonical, exact, in_window, integer, record, text, window

JOB_STATES = {
    "queued",
    "awaiting_approval",
    "rejected",
    "cancelled",
    "verified",
    "completed_with_errors",
    "expired",
}
ROW_STATES = {"pending", "writing", "verified", "failed", "uncertain", "cancelled"}
TERMINAL = JOB_STATES - {"queued", "awaiting_approval"}


def moment(value: Any) -> datetime:
    result = datetime.fromisoformat(text(value, 64))
    if result.tzinfo is None:
        raise AccessError("invalid_fields")
    return result.astimezone(UTC)


def checked_row(row: Any) -> None:
    exact(
        row,
        {
            "station_id",
            "name",
            "door",
            "identity_stamp",
            "expected",
            "changes",
            "window",
            "state",
            "code",
        },
    )
    text(row["station_id"], 128)
    text(row["name"], 128)
    integer(row["door"], 1, 2)
    digest = text(row["identity_stamp"], 64)
    if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise AccessError("invalid_fields")
    for key in ("expected", "changes"):
        record("door_presets", {"label": "validation", "changes": row[key]})
    if set(row["changes"]) - set(row["expected"]) or set(row["expected"]) - set(FIELDS):
        raise AccessError("invalid_fields")
    window(row["window"])
    if row["state"] not in ROW_STATES:
        raise AccessError("invalid_fields")
    text(row["code"], 128, empty=True)


def fingerprint(job: dict[str, Any]) -> str:
    return sha256(
        canonical(
            {
                "id": job["id"],
                "actor": job["actor"],
                "created_at": job["created_at"],
                "expires_at": job["expires_at"],
                "dual_required": job["dual_required"],
                "rows": [
                    {k: v for k, v in row.items() if k not in {"state", "code"}}
                    for row in job["rows"]
                ],
            }
        )
    ).hexdigest()


class MaintenanceJobs:
    def __init__(self, save: Callable[[dict[str, Any]], Awaitable[None]]) -> None:
        self._save = save
        self._lock = asyncio.Lock()
        self._run_lock = asyncio.Lock()
        self._cursor = 0
        self.data: dict[str, Any] = {"schema": 1, "jobs": {}}

    def validate(self, data: Any) -> None:
        exact(data, {"schema", "jobs"})
        if (
            type(data["schema"]) is not int
            or data["schema"] != 1
            or not isinstance(data["jobs"], dict)
            or len(data["jobs"]) > 100
        ):
            raise AccessError("invalid_fields")
        for identifier, job in data["jobs"].items():
            exact(
                job,
                {
                    "id",
                    "actor",
                    "created_at",
                    "expires_at",
                    "dual_required",
                    "consent",
                    "state",
                    "rows",
                },
            )
            if identifier != job["id"]:
                raise AccessError("invalid_fields")
            text(identifier, 128)
            text(job["actor"], 128)
            created, expiry = moment(job["created_at"]), moment(job["expires_at"])
            if (
                not created < expiry <= created + timedelta(days=8)
                or type(job["dual_required"]) is not bool
            ):
                raise AccessError("invalid_fields")
            if (
                job["state"] not in JOB_STATES
                or not isinstance(job["rows"], list)
                or not 1 <= len(job["rows"]) <= 20
            ):
                raise AccessError("invalid_fields")
            ids = []
            for row in job["rows"]:
                checked_row(row)
                ids.append(row["station_id"])
            if len(set(ids)) != len(ids):
                raise AccessError("invalid_fields")
            consent = job["consent"]
            if consent is not None:
                exact(consent, {"actor", "fingerprint", "approved"})
                text(consent["actor"], 128)
                if (
                    consent["actor"] == job["actor"]
                    or consent["fingerprint"] != fingerprint(job)
                    or type(consent["approved"]) is not bool
                ):
                    raise AccessError("invalid_fields")
        if len(canonical(data)) > 1_500_000:
            raise AccessError("request_too_large")

    def load(self, data: Any) -> None:
        if data is None:
            return
        try:
            self.validate(data)
        except (AccessError, KeyError, ValueError, TypeError, OverflowError):
            raise AccessError("storage_corrupt") from None
        self.data = deepcopy(data)

    async def mutate(self, apply: Callable[[dict[str, Any]], None]) -> None:
        async with self._lock:
            candidate = deepcopy(self.data)
            apply(candidate)
            self.validate(candidate)
            await self._save(deepcopy(candidate))
            self.data = candidate

    def get(self, identifier: str, digest: str | None = None) -> dict[str, Any]:
        job = self.data["jobs"].get(identifier)
        if not job:
            raise AccessError("record_not_found")
        if digest is not None and digest != fingerprint(job):
            raise AccessError("review_expired")
        return deepcopy(job)

    def public(self, actor: str) -> list[dict[str, Any]]:
        return [
            {**deepcopy(job), "fingerprint": fingerprint(job), "own_request": actor == job["actor"]}
            for job in reversed(list(self.data["jobs"].values()))
        ]

    async def enqueue(
        self, actor: str, rows: list[dict[str, Any]], dual: bool, now: datetime
    ) -> dict[str, Any]:
        job: dict[str, Any] = {
            "id": str(uuid4()),
            "actor": actor,
            "created_at": now.isoformat(),
            "expires_at": (now + timedelta(days=8)).isoformat(),
            "dual_required": dual,
            "consent": None,
            "state": "awaiting_approval" if dual else "queued",
            "rows": [{**deepcopy(row), "state": "pending", "code": ""} for row in rows],
        }

        def apply(data: dict[str, Any]) -> None:
            if len(data["jobs"]) >= 100:
                obsolete = next(
                    (
                        key
                        for key, item in data["jobs"].items()
                        if item["state"] in TERMINAL
                        and not any(r["state"] == "writing" for r in item["rows"])
                    ),
                    None,
                )
                if obsolete is None:
                    raise AccessError("rate_limited")
                del data["jobs"][obsolete]
            data["jobs"][job["id"]] = job

        await self.mutate(apply)
        return self.get(job["id"])

    async def decide(self, identifier: str, digest: str, actor: str, approve: bool) -> None:
        def apply(data: dict[str, Any]) -> None:
            job = data["jobs"].get(identifier)
            if (
                not job
                or fingerprint(job) != digest
                or job["state"] != "awaiting_approval"
                or job["consent"]
                or moment(job["expires_at"]) <= datetime.now(UTC)
            ):
                raise AccessError("review_expired")
            if job["actor"] == actor:
                raise AccessError("separate_approver_required")
            if type(approve) is not bool:
                raise AccessError("invalid_fields")
            job["consent"] = {"actor": actor, "fingerprint": digest, "approved": approve}
            job["state"] = "queued" if approve else "rejected"
            if not approve:
                for row in job["rows"]:
                    row["state"] = "cancelled"

        await self.mutate(apply)

    async def cancel(self, identifier: str, digest: str) -> None:
        def apply(data: dict[str, Any]) -> None:
            job = data["jobs"].get(identifier)
            if not job or fingerprint(job) != digest:
                raise AccessError("review_expired")
            if job["state"] in TERMINAL:
                return
            job["state"] = "cancelled"
            for row in job["rows"]:
                if row["state"] == "pending":
                    row["state"] = "cancelled"

        await self.mutate(apply)

    async def _row(self, identifier: str, index: int, state: str, code: str = "") -> None:
        def apply(data: dict[str, Any]) -> None:
            job = data["jobs"][identifier]
            job["rows"][index].update(state=state, code=code)
            if job["state"] == "queued" and all(
                r["state"] not in {"pending", "writing"} for r in job["rows"]
            ):
                job["state"] = (
                    "verified"
                    if all(r["state"] == "verified" for r in job["rows"])
                    else "completed_with_errors"
                )

        await self.mutate(apply)

    async def run(
        self,
        now: datetime,
        *,
        guard: Callable[[dict[str, Any], dict[str, Any], bool], Awaitable[None]],
        read: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]],
        write: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]],
        budget: int = 3,
    ) -> None:
        if self._run_lock.locked():
            return
        async with self._run_lock:
            for identifier in list(self.data["jobs"]):
                job = self.get(identifier)
                if moment(job["expires_at"]) <= now and job["state"] not in TERMINAL:

                    def expire(data: dict[str, Any], identifier: str = identifier) -> None:
                        item = data["jobs"][identifier]
                        item["state"] = "expired"
                        for row in item["rows"]:
                            if row["state"] == "pending":
                                row["state"] = "cancelled"

                    await self.mutate(expire)
            work = [
                (identifier, index)
                for identifier, job in self.data["jobs"].items()
                for index in range(len(job["rows"]))
            ]
            used = 0
            start = self._cursor
            for offset in range(len(work)):
                position = (start + offset) % len(work)
                identifier, index = work[position]
                job = self.get(identifier)
                row = job["rows"][index]
                recovery = row["state"] == "writing"
                if not recovery and (
                    job["state"] != "queued"
                    or row["state"] != "pending"
                    or not in_window(row["window"], now)
                ):
                    continue
                if used >= budget:
                    return
                used += 1
                self._cursor = (position + 1) % len(work)
                attempted = recovery
                try:
                    await guard(job, row, recovery)
                    observed = await read(row)
                    desired = {**row["expected"], **row["changes"]}
                    if recovery:
                        await self._row(
                            identifier,
                            index,
                            "verified" if observed == desired else "uncertain",
                            "" if observed == desired else "write_outcome_unknown",
                        )
                        continue
                    job = self.get(identifier)
                    if job["state"] != "queued" or job["rows"][index]["state"] != "pending":
                        continue
                    if observed != row["expected"]:
                        raise AccessError("revision_conflict")
                    await guard(job, row, False)
                    # Commit write intent before any adapter can send a PUT.
                    await self._row(identifier, index, "writing")
                    job = self.get(identifier)
                    if job["state"] != "queued":
                        await self._row(identifier, index, "cancelled")
                        continue
                    await guard(job, row, False)
                    attempted = True
                    result = await write(row)
                    if result != desired:
                        raise AccessError("write_outcome_unknown")
                    await self._row(identifier, index, "verified")
                except asyncio.CancelledError:
                    raise
                except Exception as err:
                    # Store failure may itself fail; leave durable writing intent for readback.
                    if (
                        not attempted
                        and isinstance(err, AccessError)
                        and err.code == "approval_required"
                    ):

                        def wait(
                            data: dict[str, Any],
                            identifier: str = identifier,
                            index: int = index,
                        ) -> None:
                            item = data["jobs"][identifier]
                            if item["state"] == "queued":
                                item["state"] = "awaiting_approval"
                                item["rows"][index].update(
                                    state="pending", code="approval_required"
                                )

                        await self.mutate(wait)
                    else:
                        code = (
                            "connection_failed"
                            if isinstance(err, TimeoutError)
                            else err.code
                            if isinstance(err, AccessError)
                            and err.code
                            in {
                                "unauthorized",
                                "maintenance_window_closed",
                                "review_expired",
                                "write_outcome_unknown",
                            }
                            else error_code(err)
                        )
                        waiting = not attempted and code in {
                            "station_unloaded",
                            "device_busy",
                            "connection_failed",
                            "maintenance_window_closed",
                        }
                        await self._row(
                            identifier,
                            index,
                            "uncertain"
                            if recovery
                            else "writing"
                            if attempted
                            else "pending"
                            if waiting
                            else "failed",
                            code,
                        )
