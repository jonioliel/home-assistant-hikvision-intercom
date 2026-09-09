"""Bounded per-station background preflight; there is no production write queue."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Coroutine
from typing import Any

from .models import AccessError
from .schedule_operations import WORK_ERRORS, ScheduleOperations


class ScheduleWorkQueue:
    def __init__(
        self,
        store: ScheduleOperations,
        check: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]],
        changed: Callable[[], None],
        task_factory: Callable[[Coroutine[Any, Any, None]], asyncio.Task[None]],
    ) -> None:
        self.store, self._check, self._changed, self._task_factory = (
            store,
            check,
            changed,
            task_factory,
        )
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._slots = asyncio.Semaphore(3)
        self._closed = False
        self._lock = asyncio.Lock()

    async def request(self, identifier: str, revision: int) -> dict[str, Any]:
        async with self._lock:
            job = self.store.job(identifier, revision)
            if self._closed:
                raise AccessError("station_unloaded")
            if job["station_id"] in self._tasks or job["status"] in ("queued", "checking"):
                raise AccessError("schedule_read_busy")
            queued = await self.store.async_update(
                identifier, revision, status="queued", error=None
            )
            coroutine = self._run(identifier, job["station_id"])
            failed = False
            try:
                self._tasks[job["station_id"]] = self._task_factory(coroutine)
            except Exception:
                coroutine.close()
                failed = True
            if failed:
                await self.store.async_update(
                    identifier,
                    queued["revision"],
                    status="failed",
                    error="schedule_operation_failed",
                )
                self._changed()
                raise AccessError("schedule_operation_failed")
            self._changed()
            return queued

    async def _run(self, identifier: str, station: str) -> None:
        try:
            failure = None
            try:
                async with self._slots:
                    job = self.store.job(identifier)
                    job = await self.store.async_update(
                        identifier, job["revision"], status="checking", error=None
                    )
                    self._changed()
                    result = await self._check(job)
                    if not self._closed:
                        await self.store.async_update(identifier, job["revision"], **result)
            except asyncio.CancelledError:
                raise
            except Exception as err:
                failure = (
                    err.code
                    if isinstance(err, AccessError) and err.code in WORK_ERRORS
                    else "schedule_operation_failed"
                )
            # Persist outside the handler so private exception text cannot become its context.
            if failure is not None and not self._closed:
                job = self.store.job(identifier)
                try:
                    await self.store.async_update(
                        identifier, job["revision"], status="failed", error=failure
                    )
                except AccessError:
                    pass  # AccessStore raises a Repair; persisted checking remains recoverable.
        finally:
            self._tasks.pop(station, None)
            self._changed()

    async def cancel(
        self, identifier: str, revision: int, cleanup: Callable[[dict[str, Any]], Awaitable[None]]
    ) -> dict[str, Any]:
        async with self._lock:
            job = self.store.job(identifier, revision)
            if job["station_id"] in self._tasks:
                raise AccessError("schedule_operation_retained")
            await cleanup(job)
            result = await self.store.async_update(
                identifier, revision, status="cancelled", error=None, journal_id=None
            )
            self._changed()
            return result

    async def close(self) -> None:
        self._closed = True
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
