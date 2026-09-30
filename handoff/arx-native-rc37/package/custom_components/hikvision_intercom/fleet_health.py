"""Bounded, observational station-health history; no device commands."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import Any

from .access.models import AccessError

_INTERVAL = timedelta(minutes=5)
_RETENTION = timedelta(days=7)
_MAX_SAMPLES = 2100
_STATES = {
    "synced",
    "pending",
    "syncing",
    "offline",
    "conflict",
    "error",
    "delete_pending",
    "unknown",
}


class FleetHealth:
    def __init__(self, save: Callable[[dict[str, Any]], Awaitable[None]]) -> None:
        self._save = save
        self._samples: dict[str, list[dict[str, Any]]] = {}
        self._revision = 0
        self._saved = 0
        self._lock = asyncio.Lock()
        self.storage_failed = False

    def load(self, stored: dict[str, Any] | None) -> None:
        if stored is None:
            return
        if (
            not isinstance(stored, dict)
            or stored.get("schema") != 1
            or not isinstance(stored.get("stations"), dict)
        ):
            raise AccessError("invalid_storage")
        samples: dict[str, list[dict[str, Any]]] = {}
        for station_id, rows in stored["stations"].items():
            if (
                not isinstance(station_id, str)
                or not isinstance(rows, list)
                or len(rows) > _MAX_SAMPLES
            ):
                raise AccessError("invalid_storage")
            clean = []
            for row in rows:
                if not isinstance(row, dict) or set(row) != {
                    "at",
                    "online",
                    "poll_ms",
                    "sync",
                    "events",
                }:
                    raise AccessError("invalid_storage")
                try:
                    at = datetime.fromisoformat(row["at"])
                except (TypeError, ValueError):
                    raise AccessError("invalid_storage") from None
                if (
                    at.tzinfo is None
                    or type(row["online"]) is not bool
                    or not isinstance(row["sync"], str)
                    or row["sync"] not in _STATES
                    or not isinstance(row["events"], str)
                    or len(row["events"]) > 32
                    or row["poll_ms"] is not None
                    and (
                        type(row["poll_ms"]) not in (int, float)
                        or not 0 <= row["poll_ms"] <= 120000
                    )
                ):
                    raise AccessError("invalid_storage")
                clean.append(dict(row))
            samples[station_id] = clean
        self._samples = samples
        self._prune(datetime.now(UTC))

    def _prune(self, now: datetime) -> None:
        cutoff = now - _RETENTION
        for station_id, rows in list(self._samples.items()):
            kept = [row for row in rows if datetime.fromisoformat(row["at"]) >= cutoff]
            if kept:
                self._samples[station_id] = kept[-_MAX_SAMPLES:]
            else:
                del self._samples[station_id]

    def record(
        self,
        station_id: str,
        *,
        online: bool,
        poll_ms: float | None,
        sync: str,
        events: str,
        now: datetime | None = None,
    ) -> bool:
        now = now or datetime.now(UTC)
        if not station_id or len(station_id) > 128 or now.tzinfo is None:
            raise ValueError("Invalid station health identity or time")
        self._prune(now)
        row = {
            "at": now.astimezone(UTC).isoformat(timespec="seconds"),
            "online": bool(online),
            "poll_ms": round(poll_ms, 1) if online and poll_ms is not None else None,
            "sync": sync if sync in _STATES else "unknown",
            "events": events[:32] if isinstance(events, str) else "unknown",
        }
        records = self._samples.setdefault(station_id, [])
        if records:
            previous = records[-1]
            elapsed = now - datetime.fromisoformat(previous["at"])
            state_changed = any(previous[key] != row[key] for key in ("online", "sync", "events"))
            if elapsed < _INTERVAL and not state_changed:
                return False
        records.append(row)
        del records[:-_MAX_SAMPLES]
        self._revision += 1
        return True

    def public(self, station_id: str) -> dict[str, Any]:
        self._prune(datetime.now(UTC))
        return {
            "station_id": station_id,
            "period_days": 7,
            "records": deepcopy(self._samples.get(station_id, [])),
            "storage_failed": self.storage_failed,
        }

    async def async_flush(self) -> None:
        async with self._lock:
            if self._saved == self._revision:
                return
            revision = self._revision
            try:
                await self._save({"schema": 1, "stations": deepcopy(self._samples)})
            except Exception:
                self.storage_failed = True
                return
            self._saved = revision
            self.storage_failed = False
