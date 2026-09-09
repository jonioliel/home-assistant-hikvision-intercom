"""Private write-ahead journal for future, independently verified schedule transports.

No production transport or Home Assistant write entry point is registered. Proposals and
comparison baselines are not ownership evidence and cannot authorize this journal.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from copy import deepcopy
from typing import Any
from uuid import uuid4

from .models import AccessError, utc_now, uuid_text
from .repository import Save
from .schedule_baselines import valid_hash
from .schedule_comparison import canonical
from .schedule_compiler import compile_schedule
from .schedule_plans import timestamp
from .schedules import normalize

CONTEXT = {"identity", "capability", "dependencies", "ownership", "source"}
ISSUES = {None, "read_failed", "write_uncertain", "context_changed", "resource_changed"}
MAX_TRANSACTIONS = 32


def validate_context(value: Any) -> None:
    if (
        not isinstance(value, dict)
        or set(value) != CONTEXT
        or not all(valid_hash(v) for v in value.values())
    ):
        raise AccessError("schedule_deployment_invalid")


class ScheduleJournal:
    """Save intent before I/O; never discard ambiguous or partially applied work."""

    def __init__(self, save: Save) -> None:
        self._save = save
        self._state: dict[str, Any] = {
            "schema": 1,
            "key": secrets.token_hex(32),
            "transactions": {},
        }
        self._lock = asyncio.Lock()
        self._running: set[str] = set()

    def fingerprint(self, value: Any) -> str:
        data = json.dumps(
            value, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(",", ":")
        ).encode()
        return hmac.new(bytes.fromhex(self._state["key"]), data, hashlib.sha256).hexdigest()

    def _validate(self, item: Any) -> None:
        if not isinstance(item, dict) or set(item) != {
            "id",
            "revision",
            "station_id",
            "context",
            "draft",
            "bindings",
            "capabilities",
            "steps",
            "status",
            "issue",
            "created_at",
            "updated_at",
        }:
            raise AccessError("invalid_storage")
        uuid_text(item["id"])
        validate_context(item["context"])
        if (
            not isinstance(item["station_id"], str)
            or not 1 <= len(item["station_id"]) <= 64
            or type(item["revision"]) is not int
            or not 1 <= item["revision"] <= 2147483647
        ):
            raise AccessError("invalid_storage")
        timestamp(item["created_at"])
        timestamp(item["updated_at"])
        candidates = compile_schedule(item["draft"], item["bindings"], item["capabilities"])
        if (
            item["draft"] != normalize(item["draft"])
            or not isinstance(item["steps"], list)
            or len(item["steps"]) != len(candidates)
        ):
            raise AccessError("invalid_storage")
        unfinished = False
        for row, candidate in zip(item["steps"], candidates, strict=True):
            if (
                not isinstance(row, dict)
                or set(row) != {"key", "before", "after", "state", "attempted"}
                or row["key"] != candidate["key"]
                or not valid_hash(row["before"])
                or row["after"] != self.fingerprint(canonical(candidate["kind"], candidate["body"]))
                or row["state"] not in ("pending", "intent", "verified")
                or type(row["attempted"]) is not bool
            ):
                raise AccessError("invalid_storage")
            if unfinished and row["state"] != "pending":
                raise AccessError("invalid_storage")
            if (
                row["state"] == "pending"
                and row["attempted"]
                or row["state"] == "intent"
                and not row["attempted"]
            ):
                raise AccessError("invalid_storage")
            if (
                row["state"] == "verified"
                and not row["attempted"]
                and row["before"] != row["after"]
            ):
                raise AccessError("invalid_storage")
            unfinished |= row["state"] != "verified"
        if item["issue"] not in tuple(ISSUES) or item["status"] not in (
            "ready",
            "recovery_required",
            "conflict",
            "verified",
        ):
            raise AccessError("invalid_storage")
        expected = (
            "recovery_required"
            if any(s["state"] == "intent" for s in item["steps"])
            else ("ready" if unfinished else "verified")
        )
        if item["status"] != (
            "conflict" if item["issue"] in ("context_changed", "resource_changed") else expected
        ):
            raise AccessError("invalid_storage")
        if item["status"] == "verified" and item["issue"] is not None:
            raise AccessError("invalid_storage")

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
            if self._running:
                raise AccessError("schedule_deployment_busy")
            if data is None:
                await self._persist(deepcopy(self._state))
                return
            previous = self._state
            try:
                if (
                    not isinstance(data, dict)
                    or set(data) != {"schema", "key", "transactions"}
                    or type(data["schema"]) is not int
                    or data["schema"] != 1
                    or not valid_hash(data["key"])
                    or not isinstance(data["transactions"], dict)
                    or len(data["transactions"]) > MAX_TRANSACTIONS
                ):
                    raise AccessError("invalid_storage")
                # Candidate hashes must be checked using the persisted installation key.
                self._state = deepcopy(data)
                stations: set[str] = set()
                for key, item in data["transactions"].items():
                    self._validate(item)
                    if key != item["id"]:
                        raise AccessError("invalid_storage")
                    if item["status"] != "verified":
                        if item["station_id"] in stations:
                            raise AccessError("invalid_storage")
                        stations.add(item["station_id"])
            except (AccessError, ValueError, TypeError, KeyError, AttributeError, RecursionError):
                self._state = previous
                raise AccessError("invalid_storage") from None

    def get(self, identifier: str, revision: int | None = None) -> dict[str, Any]:
        item = self._state["transactions"].get(identifier)
        if item is None:
            raise AccessError("schedule_deployment_not_found")
        if revision is not None and (type(revision) is not int or revision != item["revision"]):
            raise AccessError("revision_conflict")
        return deepcopy(item)

    def public(self, identifier: str) -> dict[str, Any]:
        item = self.get(identifier)
        return {
            **{
                k: item[k]
                for k in ("id", "revision", "status", "issue", "created_at", "updated_at")
            },
            "steps": [{k: row[k] for k in ("key", "state", "attempted")} for row in item["steps"]],
        }

    async def async_prepare(
        self,
        station: str,
        draft: Any,
        bindings: Any,
        capabilities: dict[str, Any],
        context: Any,
        observed: dict[str, Any],
        owned: set[str],
    ) -> dict[str, Any]:
        """Require a caller-verified owned resource set; never adopt or allocate here."""
        async with self._lock:
            validate_context(context)
            candidates = compile_schedule(draft, bindings, capabilities)
            keys = {r["key"] for r in candidates}
            if owned != keys or set(observed) != keys:
                raise AccessError("schedule_deployment_ownership_required")
            if len(self._state["transactions"]) >= MAX_TRANSACTIONS:
                raise AccessError("schedule_deployment_limit")
            if station in self._running or any(
                t["station_id"] == station and t["status"] != "verified"
                for t in self._state["transactions"].values()
            ):
                raise AccessError("schedule_deployment_busy")
            now = utc_now()
            item: dict[str, Any] = {
                "id": str(uuid4()),
                "revision": 1,
                "station_id": station,
                "context": deepcopy(context),
                "draft": normalize(draft),
                "bindings": deepcopy(bindings),
                "capabilities": deepcopy(capabilities),
                "created_at": now,
                "updated_at": now,
                "status": "ready",
                "issue": None,
                "steps": [],
            }
            item["steps"] = [
                {
                    "key": r["key"],
                    "state": "pending",
                    "attempted": False,
                    "before": self.fingerprint(canonical(r["kind"], observed[r["key"]])),
                    "after": self.fingerprint(canonical(r["kind"], r["body"])),
                }
                for r in candidates
            ]
            self._validate(item)
            state = deepcopy(self._state)
            state["transactions"][item["id"]] = item
            await self._persist(state)
            return self.public(item["id"])

    @asynccontextmanager
    async def execution(self, identifier: str) -> AsyncIterator[None]:
        station = self.get(identifier)["station_id"]
        if station in self._running:
            raise AccessError("schedule_deployment_busy")
        self._running.add(station)
        try:
            yield
        finally:
            self._running.discard(station)

    async def async_record(
        self,
        identifier: str,
        revision: int,
        *,
        index: int | None = None,
        step_state: str | None = None,
        issue: str | None = None,
    ) -> dict[str, Any]:
        """Internal executor transition; no public API is registered for this method."""
        async with self._lock:
            item = self.get(identifier, revision)
            if item["status"] in ("verified", "conflict") or item["revision"] >= 2147483647:
                raise AccessError("schedule_deployment_terminal")
            if index is not None:
                first = next(i for i, row in enumerate(item["steps"]) if row["state"] != "verified")
                if type(index) is not int or index != first:
                    raise AccessError("schedule_deployment_invalid")
                row = item["steps"][index]
                if step_state == "intent" and row["state"] == "pending":
                    row.update(state="intent", attempted=True)
                elif step_state == "verified" and (
                    row["state"] == "intent" or row["before"] == row["after"]
                ):
                    row["state"] = "verified"
                else:
                    raise AccessError("schedule_deployment_invalid")
            elif step_state is not None:
                raise AccessError("schedule_deployment_invalid")
            item.update(revision=item["revision"] + 1, updated_at=utc_now(), issue=issue)
            item["status"] = (
                "conflict"
                if issue in ("context_changed", "resource_changed")
                else (
                    "recovery_required"
                    if any(s["state"] == "intent" for s in item["steps"])
                    else (
                        "verified"
                        if all(s["state"] == "verified" for s in item["steps"])
                        else "ready"
                    )
                )
            )
            self._validate(item)
            state = deepcopy(self._state)
            state["transactions"][identifier] = item
            await self._persist(state)
            return self.get(identifier)

    async def async_discard_unstarted(self, identifier: str, revision: int) -> None:
        async with self._lock:
            item = self.get(identifier, revision)
            if item["station_id"] in self._running or any(
                s["state"] != "pending" for s in item["steps"]
            ):
                raise AccessError("schedule_deployment_retained")
            state = deepcopy(self._state)
            del state["transactions"][identifier]
            await self._persist(state)
