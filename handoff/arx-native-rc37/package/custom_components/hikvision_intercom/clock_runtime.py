"""Refresh device display rules independently of access and call-state availability."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from time import monotonic
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .access_runtime import SIGNAL_ACCESS_CHANGED
from .client.client import HikvisionClient
from .client.clock import ClockClient
from .clock import UTC_ZONE
from .clock_health import ClockTrend
from .exceptions import HikvisionError


class StationClock:
    def __init__(
        self, hass: HomeAssistant, client: HikvisionClient, manual: dict[str, Any] | None
    ) -> None:
        self.hass, self.client, self.manual = hass, ClockClient(client), manual
        self.observed: dict[str, Any] | None = None
        self.error: str | None = None
        self.trend = ClockTrend()
        self._task: asyncio.Task[None] | None = None
        self._timer: asyncio.TimerHandle | None = None
        self._closed = False

    def start(self) -> None:
        if not self._closed and self._task is None:
            self._task = self.hass.async_create_background_task(
                self._read(), "Hikvision station clock", eager_start=False
            )

    async def async_refresh(self) -> None:
        if self._closed:
            return
        if self._timer:
            self._timer.cancel()
            self._timer = None
        self.start()
        if self._task:
            await asyncio.shield(self._task)

    async def _read(self) -> None:
        try:
            async with asyncio.timeout(20):
                self.observed = await self.client.async_read()
            self.trend.observe(self.observed, monotonic())
            self.error = None
        except (HikvisionError, TimeoutError):
            self.error = "clock_read_failed"
            self.trend.reset()
        finally:
            self._task = None
            if not self._closed:
                async_dispatcher_send(self.hass, SIGNAL_ACCESS_CHANGED)
                self._timer = self.hass.loop.call_later(900, self._scheduled)

    def _scheduled(self) -> None:
        self._timer = None
        self.start()

    def public(self) -> dict[str, Any]:
        zone = self.manual or (self.observed["zone"] if self.observed else UTC_ZONE)
        return {
            "source": "manual" if self.manual else "device" if self.observed else "fallback",
            "zone": deepcopy(zone),
            "status": "stale"
            if self.observed and self.error
            else "unavailable"
            if not self.observed
            else "ready",
            "error": self.error,
            "device_time": self.observed["device_time"] if self.observed else None,
            "checked_at": self.observed["checked_at"] if self.observed else None,
            "skew_seconds": self.observed["skew_seconds"] if self.observed else None,
            "time_mode": self.observed["time_mode"] if self.observed else None,
            "device_zone": deepcopy(self.observed["zone"]) if self.observed else None,
            "measurement": deepcopy(self.observed.get("measurement")) if self.observed else None,
            "next_transition": deepcopy(self.observed.get("next_transition"))
            if self.observed
            else None,
            "drift_state": self.trend.state,
        }

    async def async_close(self) -> None:
        self._closed = True
        if self._timer:
            self._timer.cancel()
            self._timer = None
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
