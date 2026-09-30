"""Durable scoped review receipts; decisions never mutate admission policy or equipment."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from collections.abc import Awaitable, Callable
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from .models import AccessError

MAX_RECEIPTS = 10000
STATES = {"all", "pending", "due", "stale", "completed", "followup", "archived"}
FIELDS = {
    "id",
    "user_id",
    "station_id",
    "lock_id",
    "person_revision",
    "fingerprint",
    "decision",
    "reason",
    "cadence_days",
    "at",
    "due_at",
    "actor",
}


def stamp(value: Any) -> datetime:
    try:
        if not isinstance(value, str) or len(value) > 40:
            raise ValueError
        result = datetime.fromisoformat(value)
        if result.tzinfo is None:
            raise ValueError
        return result.astimezone(UTC)
    except (ValueError, TypeError, OverflowError):
        raise AccessError("invalid_fields") from None


def identity(value: Any, maximum: int = 128) -> str:
    if not isinstance(value, str) or not re.fullmatch(
        r"[A-Za-z0-9_-]{1," + str(maximum) + r"}", value
    ):
        raise AccessError("invalid_fields")
    return value


def lock_id(value: Any) -> int:
    if type(value) is not int or value not in (1, 2):
        raise AccessError("invalid_lock")
    return int(value)


def digest(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    ).hexdigest()


def central(person: dict[str, Any], station: str, lock: int) -> dict[str, Any]:
    """Only selected-door semantics, excluding hidden/global groups and all credentials."""
    assignment = person.get("assignments", {}).get(station, {})
    timing = person.get("access_timing_policy")
    return {
        "active": person.get("active") is True,
        "archived": bool(person.get("archived_at")),
        "valid_from": person.get("valid_from"),
        "valid_until": person.get("valid_until"),
        "assignment_enabled": assignment.get("enabled") is True,
        "granted": assignment.get("enabled") is True
        and lock in assignment.get("allowed_locks", []),
        "timing_mode": timing.get("mode") if timing else "unrestricted",
        "schedule": deepcopy(timing.get("schedule")) if timing else None,
    }


def fingerprint(person: dict[str, Any], station: str, lock: int) -> str:
    return digest(
        {
            "user_id": person["id"],
            "station_id": station,
            "lock_id": lock,
            "central": central(person, station, lock),
        }
    )


class PermissionReviews:
    def __init__(
        self,
        save: Callable[[dict[str, Any]], Awaitable[None]],
        changed: Callable[[], None],
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._save, self._changed = save, changed
        self._now = now or (lambda: datetime.now(UTC))
        self._lock = asyncio.Lock()
        self._data: dict[str, Any] = {"schema": 1, "receipts": []}

    def load(self, data: Any) -> None:
        if data is None:
            return
        try:
            if (
                not isinstance(data, dict)
                or set(data) != {"schema", "receipts"}
                or type(data["schema"]) is not int
                or data["schema"] != 1
                or not isinstance(data["receipts"], list)
                or len(data["receipts"]) > MAX_RECEIPTS
            ):
                raise ValueError
            seen = set()
            for row in data["receipts"]:
                if (
                    not isinstance(row, dict)
                    or set(row) != FIELDS
                    or not re.fullmatch(r"[a-f0-9]{32}", row["id"])
                    or row["id"] in seen
                    or not re.fullmatch(r"[a-f0-9]{64}", row["fingerprint"])
                ):
                    raise ValueError
                seen.add(row["id"])
                identity(row["user_id"])
                identity(row["station_id"], 64)
                identity(row["actor"])
                lock_id(row["lock_id"])
                self._decision(row["decision"], row["reason"], row["cadence_days"])
                if (
                    type(row["person_revision"]) is not int
                    or row["person_revision"] < 0
                    or stamp(row["due_at"])
                    != stamp(row["at"]) + timedelta(days=row["cadence_days"])
                ):
                    raise ValueError
        except (ValueError, TypeError, KeyError, AccessError, OverflowError):
            raise AccessError("invalid_storage") from None
        self._data = deepcopy(data)

    @staticmethod
    def _decision(decision: Any, reason: Any, cadence: Any) -> None:
        if (
            not isinstance(decision, str)
            or decision not in {"keep", "followup"}
            or not isinstance(reason, str)
            or not 1 <= len(reason.strip()) <= 500
            or any(ord(c) < 32 for c in reason)
            or type(cadence) is not int
            or not 1 <= cadence <= 365
        ):
            raise AccessError("invalid_fields")

    def history(self, user_id: str, station: str, lock: int) -> list[dict[str, Any]]:
        return [
            deepcopy(row)
            for row in reversed(self._data["receipts"])
            if (row["user_id"], row["station_id"], row["lock_id"]) == (user_id, station, lock)
        ][:20]

    def preview(self, person: dict[str, Any], station: str, lock: int) -> dict[str, Any]:
        identity(person["id"])
        identity(station, 64)
        lock_id(lock)
        history = self.history(person["id"], station, lock)
        return {
            "user_id": person["id"],
            "station_id": station,
            "lock_id": lock,
            "person_revision": person["revision"],
            "fingerprint": fingerprint(person, station, lock),
            "latest_id": history[0]["id"] if history else "",
            "central": central(person, station, lock),
            "history": history,
            "scope": "selected_door",
            "access_changed": False,
        }

    async def decide(
        self,
        current: Callable[[], dict[str, Any]],
        station: str,
        lock: int,
        *,
        actor: str,
        person_revision: int,
        expected_fingerprint: str,
        latest_id: str,
        decision: str,
        reason: str,
        cadence_days: int,
        confirmed: bool,
    ) -> dict[str, Any]:
        self._decision(decision, reason, cadence_days)
        identity(actor)
        identity(station, 64)
        lock_id(lock)
        if confirmed is not True:
            raise AccessError("confirmation_required")
        async with self._lock:
            person = current()  # Rechecks current authenticated grants and source while locked.
            preview = self.preview(person, station, lock)
            if (
                type(person_revision) is not int
                or preview["person_revision"] != person_revision
                or preview["fingerprint"] != expected_fingerprint
                or preview["latest_id"] != latest_id
            ):
                raise AccessError("access_review_stale")
            if len(self._data["receipts"]) >= MAX_RECEIPTS:
                raise AccessError("access_review_limit")
            at = self._now().astimezone(UTC)
            row = {
                "id": uuid4().hex,
                "user_id": person["id"],
                "station_id": station,
                "lock_id": lock,
                "person_revision": person_revision,
                "fingerprint": expected_fingerprint,
                "decision": decision,
                "reason": reason.strip(),
                "cadence_days": cadence_days,
                "at": at.isoformat(timespec="seconds"),
                "due_at": (at + timedelta(days=cadence_days)).isoformat(timespec="seconds"),
                "actor": actor,
            }
            draft = deepcopy(self._data)
            draft["receipts"].append(row)

            async def persist() -> None:
                await self._save(deepcopy(draft))
                self._data = draft
                self._changed()

            task = asyncio.create_task(persist())
            cancelled = False
            while not task.done():
                try:
                    await asyncio.shield(task)
                except asyncio.CancelledError:
                    cancelled = True
            task.result()
            if cancelled:
                raise asyncio.CancelledError
            return {"receipt": deepcopy(row), "access_changed": False, "scope": "selected_door"}

    def report(
        self,
        people: list[dict[str, Any]],
        station: str,
        lock: int,
        *,
        user_id: str = "",
        state: str = "all",
        offset: int = 0,
        limit: int = 50,
        snapshot: str = "",
        permission_context: str = "",
    ) -> dict[str, Any]:
        identity(station, 64)
        lock_id(lock)
        if (
            not isinstance(state, str)
            or state not in STATES
            or type(offset) is not int
            or offset < 0
            or type(limit) is not int
            or not 1 <= limit <= 100
            or not isinstance(snapshot, str)
            or len(snapshot) > 64
        ):
            raise AccessError("invalid_fields")
        now = self._now().astimezone(UTC)
        # Build indexes only for caller-projected people and explicit selected door.
        visible = {
            p["id"]: p
            for p in people
            if (not user_id or p["id"] == user_id) and station in p.get("assignments", {})
        }
        latest: dict[str, dict[str, Any]] = {}
        for receipt in self._data["receipts"]:
            if (
                receipt["user_id"] in visible
                and receipt["station_id"] == station
                and receipt["lock_id"] == lock
            ):
                latest[receipt["user_id"]] = receipt
        rows = []
        summary = {key: 0 for key in STATES - {"all"}}
        for person in visible.values():
            receipt = latest.get(person["id"])
            if person.get("archived_at"):
                status = "archived"
            elif receipt is None:
                status = "pending"
            elif receipt["fingerprint"] != fingerprint(person, station, lock):
                status = "stale"
            elif receipt["decision"] == "followup":
                status = "followup"
            elif stamp(receipt["due_at"]) <= now:
                status = "due"
            else:
                status = "completed"
            summary[status] += 1
            rows.append(
                {
                    "user_id": person["id"],
                    "display_name": person["display_name"],
                    "person_revision": person["revision"],
                    "status": status,
                    "central": central(person, station, lock),
                    "latest": deepcopy(receipt),
                    "sync_state": person.get("assignments", {})
                    .get(station, {})
                    .get("sync_state", "unknown"),
                }
            )
        rows.sort(key=lambda row: (row["display_name"].casefold(), row["user_id"]))
        token = digest(
            {
                "station": station,
                "lock": lock,
                "state": state,
                "user": user_id,
                "context": permission_context,
                "rows": rows,
            }
        )
        filtered = [row for row in rows if state == "all" or row["status"] == state]
        stale = bool(snapshot and snapshot != token)
        return {
            "snapshot": token,
            "stale": stale,
            "total": len(filtered),
            "offset": offset,
            "limit": limit,
            "next_offset": offset + limit if offset + limit < len(filtered) else None,
            "previous_offset": max(0, offset - limit) if offset else None,
            "records": [] if stale else deepcopy(filtered[offset : offset + limit]),
            "summary": summary,
            "scope": "selected_door",
            "access_changed": False,
        }
