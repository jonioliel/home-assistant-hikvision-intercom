"""Operator attestations; never execute a device action or infer physical success."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any

from .models import AccessError

STEPS = (
    "relay",
    "pin_create",
    "pin_replace",
    "pin_remove",
    "user_delete",
    "card",
    "ring",
    "answer",
    "audio",
    "video_desktop",
    "video_mobile",
    "webrtc",
    "offline_recovery",
)
STATES = ("unverified", "passed", "failed", "deferred")


class Acceptance:
    def __init__(self, save: Callable[[dict[str, Any]], Awaitable[None]]) -> None:
        self.save = save
        self.data: dict[str, Any] = {"schema": 1, "revision": 0, "stations": {}}
        self.lock = asyncio.Lock()

    async def async_load(self, data: dict[str, Any] | None) -> None:
        if data is None:
            return
        try:
            if not (set(data) == {"schema", "revision", "stations"}):
                raise ValueError("Invalid acceptance storage")
            if not (
                data["schema"] == 1 and type(data["revision"]) is int and data["revision"] >= 0
            ):
                raise ValueError("Invalid acceptance storage")
            if not (isinstance(data["stations"], dict) and len(data["stations"]) <= 100):
                raise ValueError("Invalid acceptance storage")
            for station, rows in data["stations"].items():
                if not (isinstance(station, str) and 1 <= len(station) <= 128):
                    raise ValueError("Invalid acceptance storage")
                if not (isinstance(rows, dict) and set(rows) <= set(STEPS)):
                    raise ValueError("Invalid acceptance storage")
                for row in rows.values():
                    if not (set(row) == {"state", "checked_at", "basis"}):
                        raise ValueError("Invalid acceptance storage")
                    if not (row["state"] in STATES and row["basis"] == "operator_report"):
                        raise ValueError("Invalid acceptance storage")
                    if not (isinstance(row["checked_at"], str)):
                        raise ValueError("Invalid acceptance storage")
                    if not (datetime.fromisoformat(row["checked_at"]).tzinfo is not None):
                        raise ValueError("Invalid acceptance storage")
        except (AssertionError, TypeError, ValueError, KeyError, AttributeError):
            raise AccessError("invalid_storage") from None
        self.data = deepcopy(data)

    def public(self, station: str) -> dict[str, Any]:
        return {
            "revision": self.data["revision"],
            "steps": list(STEPS),
            "results": deepcopy(self.data["stations"].get(station, {})),
            "basis": "operator_report",
        }

    async def update(self, station: str, step: str, state: str, revision: int) -> dict[str, Any]:
        if (
            step not in STEPS
            or state not in STATES
            or not isinstance(station, str)
            or not 1 <= len(station) <= 128
        ):
            raise AccessError("invalid_fields")
        async with self.lock:
            if type(revision) is not int or revision != self.data["revision"]:
                raise AccessError("revision_conflict")
            if station not in self.data["stations"] and len(self.data["stations"]) >= 100:
                raise AccessError("capacity_reached")
            draft = deepcopy(self.data)
            draft["stations"].setdefault(station, {})[step] = {
                "state": state,
                "checked_at": datetime.now(UTC).isoformat(),
                "basis": "operator_report",
            }
            draft["revision"] += 1
            await self.save(draft)
            self.data = draft
            return self.public(station)
