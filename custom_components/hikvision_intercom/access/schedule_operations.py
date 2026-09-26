"""Local resource responsibility, deployment work and bounded audit archive.

An administrator declaration records management responsibility, not proof that a
resource is unused or permission to bypass device/protocol/dependency checks.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import secrets
import time
from collections.abc import Callable
from copy import deepcopy
from typing import Any
from uuid import uuid4

from .models import AccessError, utc_now, uuid_text
from .repository import Save
from .schedule_baselines import valid_hash
from .schedule_comparison import canonical
from .schedule_compiler import ROOTS, compile_schedule
from .schedule_plans import BLOCKERS, timestamp, validate_report

WORK_ERRORS = {
    "schedule_operation_failed",
    "schedule_source_changed",
    "schedule_plan_not_found",
    "schedule_operation_interrupted",
    "schedule_read_busy",
    "station_offline",
    "station_unloaded",
    "authentication_failed",
    "connection_failed",
    "schedule_ownership_changed",
    "schedule_plan_device_changed",
}
STATES = {
    "pending",
    "queued",
    "checking",
    "blocked",
    "ready",
    "interrupted",
    "failed",
    "cancelled",
    "verified",
}


def resource(key: Any) -> dict[str, Any]:
    if not isinstance(key, str) or ":" not in key:
        raise AccessError("invalid_storage")
    kind, number = key.split(":", 1)
    if (
        kind not in ROOTS
        or not number.isascii()
        or not number.isdecimal()
        or not 1 <= len(number) <= 5
    ):
        raise AccessError("invalid_storage")
    identifier = int(number)
    if str(identifier) != number or not 1 <= identifier <= 65535:
        raise AccessError("invalid_storage")
    return {"kind": kind, "id": identifier}


class ScheduleOperations:
    def __init__(self, save: Save, *, now: Callable[[], float] = time.monotonic) -> None:
        self._save, self._now = save, now
        self._lock = asyncio.Lock()
        self._state: dict[str, Any] = {
            "schema": 1,
            "key": secrets.token_hex(32),
            "claims": {},
            "jobs": {},
            "archive": [],
        }
        self._pending: dict[str, dict[str, Any]] = {}

    def fingerprint(self, value: Any) -> str:
        encoded = json.dumps(
            value, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(",", ":")
        ).encode()
        return hmac.new(bytes.fromhex(self._state["key"]), encoded, hashlib.sha256).hexdigest()

    @staticmethod
    def _base(item: Any) -> None:
        uuid_text(item["id"])
        uuid_text(item["plan_id"])
        timestamp(item["created_at"])
        if (
            type(item["revision"]) is not int
            or not 1 <= item["revision"] <= 2147483647
            or not isinstance(item["station_id"], str)
            or not 1 <= len(item["station_id"]) <= 64
        ):
            raise AccessError("invalid_storage")

    def _validate_claim(self, item: Any) -> None:
        if not isinstance(item, dict) or set(item) != {
            "id",
            "revision",
            "plan_id",
            "station_id",
            "identity",
            "members",
            "created_at",
        }:
            raise AccessError("invalid_storage")
        self._base(item)
        if (
            not valid_hash(item["identity"])
            or not isinstance(item["members"], dict)
            or not 1 <= len(item["members"]) <= 67
        ):
            raise AccessError("invalid_storage")
        for key, digest in item["members"].items():
            resource(key)
            if not valid_hash(digest):
                raise AccessError("invalid_storage")

    def _validate_job(self, item: Any) -> None:
        if not isinstance(item, dict) or set(item) != {
            "id",
            "revision",
            "plan_id",
            "plan_revision",
            "station_id",
            "name",
            "resource_keys",
            "created_at",
            "updated_at",
            "status",
            "error",
            "blockers",
            "report",
            "journal_id",
            "ownership",
        }:
            raise AccessError("invalid_storage")
        self._base(item)
        timestamp(item["updated_at"])
        if (
            type(item["plan_revision"]) is not int
            or not 1 <= item["plan_revision"] <= 2147483647
            or not isinstance(item["name"], str)
            or not 1 <= len(item["name"]) <= 64
            or item["status"] not in tuple(STATES)
            or item["error"] not in (None, *WORK_ERRORS)
            or item["ownership"] not in ("not_checked", "missing", "current", "changed")
            or not isinstance(item["resource_keys"], list)
            or not 1 <= len(item["resource_keys"]) <= 67
        ):
            raise AccessError("invalid_storage")
        candidates = [resource(key) for key in item["resource_keys"]]
        if len(set(item["resource_keys"])) != len(candidates):
            raise AccessError("invalid_storage")
        if item["journal_id"] is not None:
            uuid_text(item["journal_id"])
        blockers = item["blockers"]
        if (
            not isinstance(blockers, list)
            or any(not isinstance(b, str) or b not in BLOCKERS | WORK_ERRORS for b in blockers)
            or len(set(blockers)) != len(blockers)
        ):
            raise AccessError("invalid_storage")
        if item["report"] is not None:
            validate_report(item["report"], candidates)

    async def _persist(self, state: dict[str, Any]) -> None:
        async def commit() -> None:
            await self._save(deepcopy(state))
            self._state = state

        task = asyncio.create_task(commit())
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            await task
            raise

    async def async_load(self, data: Any) -> None:
        async with self._lock:
            if data is None:
                await self._persist(deepcopy(self._state))
                return
            try:
                if (
                    not isinstance(data, dict)
                    or set(data) != set(self._state)
                    or type(data["schema"]) is not int
                    or data["schema"] != 1
                    or not valid_hash(data["key"])
                    or not isinstance(data["claims"], dict)
                    or len(data["claims"]) > 64
                    or not isinstance(data["jobs"], dict)
                    or len(data["jobs"]) > 32
                    or not isinstance(data["archive"], list)
                    or len(data["archive"]) > 128
                ):
                    raise AccessError("invalid_storage")
                claimed: set[tuple[str, str]] = set()
                for key, claim in data["claims"].items():
                    self._validate_claim(claim)
                    members = {(claim["station_id"], k) for k in claim["members"]}
                    if key != claim["id"] or claimed & members:
                        raise AccessError("invalid_storage")
                    claimed.update(members)
                seen: set[str] = set()
                for job in [*data["jobs"].values(), *data["archive"]]:
                    self._validate_job(job)
                    if job["id"] in seen:
                        raise AccessError("invalid_storage")
                    seen.add(job["id"])
                if any(key != job["id"] for key, job in data["jobs"].items()) or any(
                    j["status"] not in ("verified", "cancelled") for j in data["archive"]
                ):
                    raise AccessError("invalid_storage")
                state = deepcopy(data)
                changed = False
                for job in state["jobs"].values():
                    if job["status"] in ("queued", "checking"):
                        if job["revision"] >= 2147483647:
                            raise AccessError("invalid_storage")
                        job.update(
                            status="interrupted",
                            error="schedule_operation_interrupted",
                            revision=job["revision"] + 1,
                        )
                        changed = True
            except (AccessError, ValueError, TypeError, KeyError, AttributeError, RecursionError):
                raise AccessError("invalid_storage") from None
            if changed:
                await self._persist(state)
            else:
                self._state = state
            self._pending.clear()

    def public(self) -> dict[str, Any]:
        return {
            "claims": [self.claim(c["id"]) for c in self._state["claims"].values()],
            "jobs": deepcopy(list(self._state["jobs"].values())),
            "archive": deepcopy(self._state["archive"]),
        }

    def claim(self, identifier: str) -> dict[str, Any]:
        item = self._state["claims"].get(identifier)
        if not item:
            raise AccessError("schedule_claim_not_found")
        return {
            **{k: item[k] for k in ("id", "revision", "plan_id", "station_id", "created_at")},
            "resource_keys": list(item["members"]),
        }

    def members(self, plan: dict[str, Any], inspection: dict[str, Any]) -> dict[str, str]:
        return {
            r["key"]: self.fingerprint(canonical(r["kind"], inspection["observed"][r["key"]]))
            for r in compile_schedule(plan["draft"], plan["bindings"], plan["capabilities"])
        }

    def ownership(self, plan: dict[str, Any], inspection: dict[str, Any]) -> tuple[str, str]:
        current = self.members(plan, inspection)
        applicable = [
            c
            for c in self._state["claims"].values()
            if c["station_id"] == plan["station_id"] and c["members"].keys() & current.keys()
        ]
        if not applicable:
            return "missing", self.fingerprint([])
        owned = {
            k: v
            for c in applicable
            if c["identity"] == plan["identity"]
            for k, v in c["members"].items()
        }
        matches = all(owned.get(k) == value for k, value in current.items())
        return ("current" if matches else "changed"), self.fingerprint(applicable)

    def preview_claim(
        self, plan: dict[str, Any], inspection: dict[str, Any], actor: str
    ) -> dict[str, Any]:
        members = self.members(plan, inspection)
        if any(
            c["station_id"] == plan["station_id"] and c["members"].keys() & members.keys()
            for c in self._state["claims"].values()
        ):
            raise AccessError("schedule_claim_conflict")
        self._pending = {
            k: v
            for k, v in self._pending.items()
            if v["expires"] > self._now() and v["actor"] != actor
        }
        if len(self._pending) >= 16:
            self._pending.pop(next(iter(self._pending)))
        item = {
            "id": str(uuid4()),
            "revision": 1,
            "plan_id": plan["id"],
            "station_id": plan["station_id"],
            "identity": plan["identity"],
            "members": members,
            "created_at": utc_now(),
        }
        self._validate_claim(item)
        token = uuid4().hex
        self._pending[token] = {
            "actor": actor,
            "expires": self._now() + 300,
            "plan_revision": plan["revision"],
            "item": item,
        }
        return {
            "token": token,
            "plan_id": plan["id"],
            "plan_revision": plan["revision"],
            "resource_keys": list(members),
            "report": deepcopy(inspection["report"]),
        }

    def pending_claim(self, token: str, actor: str) -> dict[str, Any]:
        pending = self._pending.get(token)
        if not pending or pending["actor"] != actor or pending["expires"] <= self._now():
            raise AccessError("schedule_claim_expired")
        return deepcopy(pending)

    async def async_claim(self, token: str, actor: str, plan: dict[str, Any]) -> dict[str, Any]:
        async with self._lock:
            pending = self.pending_claim(token, actor)
            item = pending["item"]
            if (
                pending["plan_revision"] != plan["revision"]
                or item["plan_id"] != plan["id"]
                or item["identity"] != plan["identity"]
            ):
                raise AccessError("revision_conflict")
            if len(self._state["claims"]) >= 64:
                raise AccessError("schedule_operation_limit")
            if any(
                c["station_id"] == item["station_id"]
                and c["members"].keys() & item["members"].keys()
                for c in self._state["claims"].values()
            ):
                raise AccessError("schedule_claim_conflict")
            del self._pending[token]
            state = deepcopy(self._state)
            state["claims"][item["id"]] = item
            await self._persist(state)
            return self.claim(item["id"])

    async def async_release(self, identifier: str, revision: int) -> None:
        async with self._lock:
            public = self.claim(identifier)
            if type(revision) is not int or revision != public["revision"]:
                raise AccessError("revision_conflict")
            if any(
                j["station_id"] == public["station_id"]
                and set(j["resource_keys"]) & set(public["resource_keys"])
                and j["status"] not in ("cancelled", "verified")
                for j in self._state["jobs"].values()
            ):
                raise AccessError("schedule_claim_in_use")
            state = deepcopy(self._state)
            del state["claims"][identifier]
            await self._persist(state)

    def job(self, identifier: str, revision: int | None = None) -> dict[str, Any]:
        item = self._state["jobs"].get(identifier)
        if not item:
            raise AccessError("schedule_operation_not_found")
        if revision is not None and (type(revision) is not int or revision != item["revision"]):
            raise AccessError("revision_conflict")
        return deepcopy(item)

    async def async_create(self, plan: dict[str, Any]) -> dict[str, Any]:
        async with self._lock:
            if len(self._state["jobs"]) >= 32:
                raise AccessError("schedule_operation_limit")
            if any(
                j["plan_id"] == plan["id"] and j["status"] not in ("cancelled", "verified")
                for j in self._state["jobs"].values()
            ):
                raise AccessError("schedule_operation_exists")
            now = utc_now()
            item = {
                "id": str(uuid4()),
                "revision": 1,
                "plan_id": plan["id"],
                "plan_revision": plan["revision"],
                "station_id": plan["station_id"],
                "name": plan["draft"]["name"],
                "resource_keys": [
                    r["key"]
                    for r in compile_schedule(plan["draft"], plan["bindings"], plan["capabilities"])
                ],
                "created_at": now,
                "updated_at": now,
                "status": "pending",
                "error": None,
                "blockers": ["schedule_writes_unverified"],
                "report": None,
                "journal_id": None,
                "ownership": "not_checked",
            }
            self._validate_job(item)
            state = deepcopy(self._state)
            state["jobs"][item["id"]] = item
            await self._persist(state)
            return deepcopy(item)

    async def async_update(self, identifier: str, revision: int, **patch: Any) -> dict[str, Any]:
        async with self._lock:
            item = self.job(identifier, revision)
            if (
                set(patch) - {"status", "error", "blockers", "report", "journal_id", "ownership"}
                or item["status"] in ("cancelled", "verified")
                or item["revision"] >= 2147483647
            ):
                raise AccessError("schedule_operation_invalid")
            item.update(patch)
            item.update(revision=item["revision"] + 1, updated_at=utc_now())
            self._validate_job(item)
            state = deepcopy(self._state)
            state["jobs"][identifier] = item
            await self._persist(state)
            return deepcopy(item)

    async def async_archive(self, identifier: str, revision: int) -> None:
        async with self._lock:
            item = self.job(identifier, revision)
            if item["status"] not in ("cancelled", "verified"):
                raise AccessError("schedule_operation_retained")
            state = deepcopy(self._state)
            state["archive"] = [*state["archive"], item][-128:]
            del state["jobs"][identifier]
            await self._persist(state)
