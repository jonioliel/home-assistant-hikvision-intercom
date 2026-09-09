"""Private schedule fingerprints and explicit, revision-checked comparison baselines.

A baseline records observations, never ownership or permission to mutate the station.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import re
import secrets
import time
from collections.abc import Callable
from copy import deepcopy
from datetime import datetime
from typing import Any
from uuid import uuid4

from .models import AccessError
from .repository import Save

KINDS = ("template", "weekly", "holiday_group", "holiday")
MAX_STATIONS = 16
HEX = re.compile(r"[0-9a-f]{64}")


def valid_hash(value: Any) -> bool:
    return isinstance(value, str) and HEX.fullmatch(value) is not None


def validate_snapshot(value: Any) -> None:
    if not isinstance(value, dict) or set(value) != set(KINDS):
        raise AccessError("invalid_storage")
    for item in value.values():
        if not isinstance(item, dict) or set(item) != {"state", "total", "rows", "capability"}:
            raise AccessError("invalid_storage")
        if item["state"] not in ("complete", "partial", "failed", "unsupported", "not_checked"):
            raise AccessError("invalid_storage")
        total, rows = item["total"], item["rows"]
        if total is not None and (type(total) is not int or not 0 <= total <= 4096):
            raise AccessError("invalid_storage")
        if not isinstance(rows, dict) or len(rows) > 4096:
            raise AccessError("invalid_storage")
        for key, digest in rows.items():
            if not isinstance(key, str) or not re.fullmatch(r"[1-9][0-9]{0,4}", key):
                raise AccessError("invalid_storage")
            if int(key) > 65535 or not valid_hash(digest):
                raise AccessError("invalid_storage")
        if item["capability"] is not None and not valid_hash(item["capability"]):
            raise AccessError("invalid_storage")
        if item["state"] in {"complete", "partial"}:
            if total is None or len(rows) > total or item["capability"] is None:
                raise AccessError("invalid_storage")
            if item["state"] == "complete" and len(rows) != total:
                raise AccessError("invalid_storage")
        elif rows:
            raise AccessError("invalid_storage")


def compare(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    checks = []
    for kind in KINDS:
        old, new = before[kind], after[kind]
        a, b = old["rows"], new["rows"]
        shared = a.keys() & b.keys()
        modified = sorted(int(k) for k in shared if a[k] != b[k])
        new_only, old_only = b.keys() - a.keys(), a.keys() - b.keys()
        added = sorted(map(int, new_only)) if old["state"] == "complete" else []
        removed = sorted(map(int, old_only)) if new["state"] == "complete" else []
        capability_changed = bool(
            old["capability"] and new["capability"] and old["capability"] != new["capability"]
        )
        full = old["state"] == new["state"] == "complete"
        checks.append(
            {
                "kind": kind,
                "state": "changed"
                if modified or added or removed or capability_changed
                else "unchanged"
                if full
                else "incomplete",
                "modified": len(modified),
                "added": len(added),
                "removed": len(removed),
                "modified_ids": modified[:20],
                "added_ids": added[:20],
                "removed_ids": removed[:20],
                "unverified_new": len(new_only) if old["state"] != "complete" else 0,
                "unverified_missing": len(old_only) if new["state"] != "complete" else 0,
                "coverage_complete": full,
                "capability_changed": capability_changed,
            }
        )
    return {
        "state": "changed"
        if any(c["state"] == "changed" for c in checks)
        else "unchanged"
        if all(c["coverage_complete"] for c in checks)
        else "incomplete",
        "checks": checks,
    }


class ScheduleBaselines:
    """Bounded private storage; only server-observed, short-lived tokens can be saved."""

    def __init__(self, save: Save, *, now: Callable[[], float] = time.monotonic) -> None:
        self._save, self._now = save, now
        self._state: dict[str, Any] = {"schema": 1, "key": secrets.token_hex(32), "stations": {}}
        self._pending: dict[str, dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    async def async_load(self, data: Any) -> None:
        async with self._lock:
            if data is None:
                await self._save(deepcopy(self._state))
                return
            try:
                if (
                    not isinstance(data, dict)
                    or set(data) != {"schema", "key", "stations"}
                    or type(data["schema"]) is not int
                    or data["schema"] != 1
                    or not valid_hash(data["key"])
                    or not isinstance(data["stations"], dict)
                    or len(data["stations"]) > MAX_STATIONS
                ):
                    raise AccessError("invalid_storage")
                for station, item in data["stations"].items():
                    if not isinstance(station, str) or not 1 <= len(station) <= 64:
                        raise AccessError("invalid_storage")
                    if (
                        not isinstance(item, dict)
                        or set(item) != {"revision", "checked_at", "identity", "snapshot"}
                        or type(item["revision"]) is not int
                        or not 1 <= item["revision"] <= 2147483647
                        or not valid_hash(item["identity"])
                        or not isinstance(item["checked_at"], str)
                        or datetime.fromisoformat(item["checked_at"]).tzinfo is None
                    ):
                        raise AccessError("invalid_storage")
                    validate_snapshot(item["snapshot"])
            except (ValueError, TypeError, KeyError, AccessError):
                raise AccessError("invalid_storage") from None
            self._state = deepcopy(data)
            self._pending.clear()

    def fingerprint(self, value: Any) -> str:
        encoded = json.dumps(
            value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False
        )
        return hmac.new(
            bytes.fromhex(self._state["key"]), encoded.encode(), hashlib.sha256
        ).hexdigest()

    def metadata(self, station: str) -> dict[str, Any]:
        item = self._state["stations"].get(station)
        return {
            "revision": item["revision"] if item else 0,
            "checked_at": item["checked_at"] if item else None,
        }

    def observe(
        self, station: str, actor: str, identity: str, checked_at: str, snapshot: dict[str, Any]
    ) -> dict[str, Any]:
        validate_snapshot(snapshot)
        old = self._state["stations"].get(station)
        result = {**self.metadata(station), "state": "missing", "checks": [], "token": None}
        if old:
            result.update(
                compare(old["snapshot"], snapshot)
                if old["identity"] == identity
                else {"state": "identity_changed", "checks": []}
            )
        self._pending = {
            k: v
            for k, v in self._pending.items()
            if v["expires"] > self._now() and v["station"] != station
        }
        if (
            actor
            and valid_hash(identity)
            and any(s["state"] in {"complete", "partial"} for s in snapshot.values())
        ):
            if len(self._pending) < MAX_STATIONS:
                token = str(uuid4())
                self._pending[token] = {
                    "station": station,
                    "actor": actor,
                    "identity": identity,
                    "checked_at": checked_at,
                    "snapshot": deepcopy(snapshot),
                    "revision": result["revision"],
                    "expires": self._now() + 300,
                }
                result["token"] = token
        return result

    async def _persist(self, state: dict[str, Any], station: str) -> None:
        async def commit() -> None:
            await self._save(deepcopy(state))
            self._state = state
            self._pending = {k: v for k, v in self._pending.items() if v["station"] != station}

        task = asyncio.create_task(commit())
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            await task
            raise

    async def async_save(
        self, station: str, actor: str, identity: str, token: str
    ) -> dict[str, Any]:
        async with self._lock:
            pending = self._pending.get(token)
            if (
                not pending
                or pending["station"] != station
                or pending["actor"] != actor
                or pending["identity"] != identity
                or pending["expires"] <= self._now()
            ):
                raise AccessError("schedule_baseline_expired")
            if pending["revision"] != self.metadata(station)["revision"]:
                raise AccessError("revision_conflict")
            if (
                station not in self._state["stations"]
                and len(self._state["stations"]) >= MAX_STATIONS
            ):
                raise AccessError("schedule_baseline_limit")
            if pending["revision"] >= 2147483647:
                raise AccessError("schedule_baseline_limit")
            state = deepcopy(self._state)
            state["stations"][station] = {
                k: deepcopy(pending[k]) for k in ("checked_at", "identity", "snapshot")
            }
            state["stations"][station]["revision"] = pending["revision"] + 1
            await self._persist(state, station)
            return self.metadata(station)

    async def async_clear(self, station: str, revision: int) -> dict[str, Any]:
        async with self._lock:
            if type(revision) is not int or revision != self.metadata(station)["revision"]:
                raise AccessError("revision_conflict")
            state = deepcopy(self._state)
            state["stations"].pop(station, None)
            await self._persist(state, station)
            return self.metadata(station)
