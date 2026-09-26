"""Persistent HA hold-open programs using the guarded transition executor."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import datetime
from typing import Any

from .hold_open import HoldOpenDrafts, HoldOpenExecutor, policy, window
from .models import AccessError, utc_now
from .repository import Save


class HoldPrograms:
    def __init__(self, save: Save, send: Any) -> None:
        self.save, self.send = save, send
        self.state: dict[str, Any] = {"schema": 1, "programs": {}}
        self.lock = asyncio.Lock()
        self.workers: dict[str, HoldOpenExecutor] = {}
        self.locks: dict[str, asyncio.Lock] = {}

    def load(self, data: Any) -> None:
        if data is None:
            return
        try:
            if (
                set(data) != {"schema", "programs"}
                or type(data["schema"]) is not int
                or data["schema"] != 1
                or not isinstance(data["programs"], dict)
                or len(data["programs"]) > 200
            ):
                raise AccessError("invalid_storage")
            for key, item in data["programs"].items():
                if not isinstance(item, dict) or set(item) != {
                    "station_id",
                    "door",
                    "api_id",
                    "identity",
                    "revision",
                    "policy",
                    "enabled",
                    "removing",
                    "execution",
                    "error",
                    "checked_at",
                }:
                    raise AccessError("invalid_storage")
                if key != HoldOpenDrafts.key(item["station_id"], item["door"]):
                    raise AccessError("invalid_storage")
                if (
                    type(item["revision"]) is not int
                    or item["revision"] < 1
                    or type(item["enabled"]) is not bool
                    or type(item["removing"]) is not bool
                ):
                    raise AccessError("invalid_storage")
                if (
                    not isinstance(item["identity"], str)
                    or not item["identity"]
                    or len(item["identity"]) > 512
                    or type(item["api_id"]) is not int
                    or item["api_id"] not in (1, 2)
                ):
                    raise AccessError("invalid_storage")
                if item["error"] not in (None, "technical_write_unknown") or (
                    item["checked_at"] is not None and not isinstance(item["checked_at"], str)
                ):
                    raise AccessError("invalid_storage")
                policy(item["policy"])
                HoldOpenExecutor(self.save, self.send).load(item["execution"])
        except (KeyError, TypeError, ValueError):
            raise AccessError("invalid_storage") from None
        self.state = deepcopy(data)

    def listing(self, station: str) -> list[dict[str, Any]]:
        return [
            {k: deepcopy(v) for k, v in item.items() if k != "identity"}
            for item in self.state["programs"].values()
            if item["station_id"] == station
        ]

    async def persist(self, key: str, item: dict[str, Any] | None) -> None:
        async with self.lock:
            state = deepcopy(self.state)
            if item is None:
                state["programs"].pop(key, None)
            else:
                state["programs"][key] = deepcopy(item)

            async def commit() -> None:
                await self.save(state)
                self.state = state

            task = asyncio.create_task(commit())
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                await task
                raise

    def worker(self, key: str) -> HoldOpenExecutor:
        if key not in self.workers:

            async def save(execution: dict[str, Any]) -> None:
                item = self.state["programs"][key]
                await self.persist(key, {**item, "execution": execution, "checked_at": utc_now()})

            async def send(command: str) -> None:
                await self.send(deepcopy(self.state["programs"][key]), command)

            worker = HoldOpenExecutor(save, send, commissioned=True)
            worker.load(self.state["programs"][key]["execution"])
            self.workers[key] = worker
        return self.workers[key]

    async def update(
        self,
        station: str,
        door: int,
        revision: int,
        value: Any,
        identity: str,
        api_id: int,
        enabled: bool,
    ) -> None:
        parsed = policy(value)
        key = HoldOpenDrafts.key(station, door)
        async with self.locks.setdefault(key, asyncio.Lock()):
            old = self.state["programs"].get(key)
            if type(revision) is not int or revision != (old["revision"] if old else 0):
                raise AccessError("revision_conflict")
            if old and (old["enabled"] or old["execution"]["owned"] or old["removing"]):
                raise AccessError("hold_pause_before_edit")
            if not old and len(self.state["programs"]) >= 200:
                raise AccessError("schedule_limit")
            await self.persist(
                key,
                {
                    "station_id": station,
                    "door": door,
                    "api_id": api_id,
                    "identity": identity,
                    "revision": revision + 1,
                    "policy": parsed,
                    "enabled": enabled,
                    "removing": False,
                    "execution": {"owned": False, "attempted": None, "status": "idle"},
                    "error": None,
                    "checked_at": None,
                },
            )
            self.workers.pop(key, None)

    async def action(self, station: str, door: int, revision: int, action: str) -> None:
        if action not in {"pause", "remove"}:
            raise AccessError("invalid_fields")
        key = HoldOpenDrafts.key(station, door)
        async with self.locks.setdefault(key, asyncio.Lock()):
            item = self.state["programs"].get(key)
            if type(revision) is not int or item is None or item["revision"] != revision:
                raise AccessError("revision_conflict")
            await self.persist(
                key,
                {
                    **item,
                    "enabled": False,
                    "removing": action == "remove",
                    "revision": revision + 1,
                },
            )
        await self.tick_key(key, datetime.now().astimezone())

    async def tick_key(self, key: str, now: datetime) -> None:
        async with self.locks.setdefault(key, asyncio.Lock()):
            item = self.state["programs"].get(key)
            if item is None:
                return
            worker = self.worker(key)
            try:
                desired = (
                    window(item["policy"], now)
                    if item["enabled"] and not item["removing"]
                    else None
                )
                await worker.tick(desired)
            except Exception:
                await self.persist(
                    key, {**self.state["programs"][key], "error": "technical_write_unknown"}
                )
                return
            current = self.state["programs"][key]
            if current["removing"] and not worker.state["owned"]:
                await self.persist(key, None)
                self.workers.pop(key, None)
            elif current["error"]:
                await self.persist(key, {**current, "error": None})

    async def tick(self, now: datetime) -> None:
        slots = asyncio.Semaphore(3)

        async def run(key: str) -> None:
            async with slots:
                await self.tick_key(key, now)

        await asyncio.gather(*(run(key) for key in list(self.state["programs"])))
