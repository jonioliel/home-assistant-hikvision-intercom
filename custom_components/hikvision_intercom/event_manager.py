"""Own bounded audit persistence, live event subscriptions and station recovery."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .access.models import AccessError
from .access_runtime import SIGNAL_ACCESS_CHANGED
from .client.events import EventClient, HistoryWindowFull, create_event_session
from .const import DOMAIN, VERSION
from .event_diagnostics import EventTelemetry, event_support, explain_event
from .event_trace import EventTrace
from .events import EventCache, normalize_event, timestamp
from .exceptions import HikvisionAuthError, HikvisionError, HikvisionUnsupportedError
from .issues import issue
from .storage import AccessStore

if TYPE_CHECKING:
    from .runtime import IntercomRuntime

_LOGGER = logging.getLogger(__name__)
SIGNAL_EVENT = f"{DOMAIN}_event"


class EventManager:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store = AccessStore(hass, key=f"{DOMAIN}.events")
        self.cache = EventCache()
        self.key = secrets.token_bytes(32)
        self.cursors: dict[str, str] = {}
        self.stations: dict[str, StationEvents] = {}
        self.storage_failed = False
        self._revision = 0
        self._saved = 0
        self._timer: asyncio.TimerHandle | None = None
        self._save_lock = asyncio.Lock()
        self._closing = False
        self._prune_timer: asyncio.TimerHandle | None = None

    async def async_load(self) -> None:
        data = await self.store.async_load()
        if data:
            self.key = bytes.fromhex(data["fingerprint_key"])
            if len(self.key) != 32 or not isinstance(data.get("cursors"), dict):
                raise ValueError("Invalid event storage")
            self.cursors = {
                key: value for key, value in data["cursors"].items() if timestamp(value)
            }
        self.cache.load(data, datetime.now(UTC))
        # Persist the event ID key before it can be used by a stream.
        await self.store.async_save(self._data())
        self._prune_timer = self.hass.loop.call_later(3600, self._prune)

    @callback
    def _prune(self) -> None:
        before = len(self.cache.rows)
        self.cache.prune(datetime.now(UTC))
        if len(self.cache.rows) != before:
            self.changed()
        if not self._closing:
            self._prune_timer = self.hass.loop.call_later(3600, self._prune)

    def _data(self) -> dict[str, Any]:
        return {
            **self.cache.dump(),
            "fingerprint_key": self.key.hex(),
            "cursors": dict(self.cursors),
        }

    @callback
    def changed(self) -> None:
        self._revision += 1
        async_dispatcher_send(self.hass, SIGNAL_ACCESS_CHANGED)
        if self._timer is None and not self._closing:
            self._timer = self.hass.loop.call_later(2, self._save_due)

    @callback
    def _save_due(self) -> None:
        self._timer = None
        self.hass.async_create_background_task(
            self.async_flush(), "Hikvision event save", eager_start=False
        )

    async def async_flush(self) -> None:
        async with self._save_lock:
            if self._saved == self._revision:
                return
            revision = self._revision
            data = self._data()
            try:
                if self._closing:
                    await self.hass.async_add_executor_job(self.store._save_strict, data)
                else:
                    await self.store.async_save(data)
            except Exception:
                if not self.storage_failed:
                    _LOGGER.error("Event history could not be saved; private records omitted")
                self.storage_failed = True
                if not self._closing and self._timer is None:
                    self._timer = self.hass.loop.call_later(30, self._save_due)
                return
            self.storage_failed = False
            self._saved = revision

    @callback
    def accept(self, row: dict[str, Any]) -> bool:
        if self._closing:
            return False
        before = len(self.cache.rows)
        if not self.cache.add(row, datetime.now(UTC)):
            if len(self.cache.rows) != before:
                self.changed()
            return False
        self.changed()
        if not row["recovered"]:
            async_dispatcher_send(self.hass, SIGNAL_EVENT, dict(row))
        return True

    def query(self, filters: dict[str, Any]) -> dict[str, Any]:
        before = len(self.cache.rows)
        result = self.cache.query(filters, datetime.now(UTC))
        if len(self.cache.rows) != before:
            self.changed()
        return {
            **result,
            "records": [{**row, "evidence": explain_event(row)} for row in result["records"]],
            "storage_failed": self.storage_failed,
            "stations": {key: value.status() for key, value in self.stations.items()},
        }

    async def async_report(
        self, filters: dict[str, Any], *, export: bool = False
    ) -> dict[str, Any]:
        from .reporting import build_report

        if set(filters) & {"limit", "before"}:
            from .exceptions import HikvisionValidationError

            raise HikvisionValidationError("Reports do not accept pagination")
        before = len(self.cache.rows)
        now = datetime.now(UTC)
        page = self.cache.query(filters, now, all_records=True)
        if len(self.cache.rows) != before:
            self.changed()
        # Capture HA-owned metadata before running only detached records in the worker.
        metadata = {
            "retention_days": page["retention_days"],
            "capacity": page["capacity"],
            "storage_failed": self.storage_failed,
            "stations": {key: value.status() for key, value in self.stations.items()},
        }
        names = {
            key: entry.title
            for key in {row["station_id"] for row in page["records"]}
            if (entry := self.hass.config_entries.async_get_entry(key)) is not None
        }
        zones = {
            key: station.runtime.clock.public()["zone"]
            for key, station in self.stations.items()
            if station.runtime.clock
        }
        result = await self.hass.async_add_executor_job(
            build_report, page["records"], now, names, export, zones
        )
        return {**result, **metadata}

    def latest_access(self, station_ids: set[str]) -> dict[str, dict[str, Any]]:
        before = len(self.cache.rows)
        result = self.cache.latest_access(station_ids, datetime.now(UTC))
        if len(self.cache.rows) != before:
            self.changed()
        return result

    def detail(self, identifier: str, *, export: bool = False) -> dict[str, Any]:
        before = len(self.cache.rows)
        self.cache.prune(datetime.now(UTC))
        if len(self.cache.rows) != before:
            self.changed()
        row = self.cache.rows.get(identifier)
        if row is None:
            raise AccessError("event_not_found")
        report = event_support(row, VERSION)
        station = self.stations.get(row["station_id"])
        report["source_identity"] = station.trace.evidence.get(identifier) if station else None
        if not export:
            report["record"] = dict(row)
        return report

    def attach(self, runtime: IntercomRuntime) -> StationEvents:
        station = StationEvents(self, runtime)
        self.stations[runtime.station_id] = station
        station.start()
        return station

    async def async_close(self) -> None:
        self._closing = True
        if self._prune_timer:
            self._prune_timer.cancel()
            self._prune_timer = None
        if self._timer:
            self._timer.cancel()
            self._timer = None
        for station in list(self.stations.values()):
            await station.async_close()
        await self.async_flush()


class StationEvents:
    def __init__(self, manager: EventManager, runtime: IntercomRuntime) -> None:
        self.manager, self.runtime = manager, runtime
        self.client = EventClient(runtime.client)
        self.stream_state = "connecting"
        self.history_state = "pending"
        self.reconnects = 0
        self.telemetry = EventTelemetry()
        self.trace = EventTrace()
        self.last_frame_at: str | None = None
        self._tasks: list[asyncio.Task[Any]] = []
        self._closed = False
        self._previous_call = runtime.coordinator.data.normalized
        self._last_ring = float("-inf")
        self._unsubscribe = runtime.coordinator.async_add_listener(self._call_changed)

    def start(self) -> None:
        for coro, name in ((self._stream(), "stream"), (self._history(), "history")):
            self._tasks.append(
                self.manager.hass.async_create_background_task(
                    coro,
                    f"Hikvision {name}",
                    eager_start=False,
                )
            )

    def status(self) -> dict[str, Any]:
        return {
            "stream": self.stream_state,
            "history": self.history_state,
            "reconnects": self.reconnects,
            "last_frame_at": self.last_frame_at,
            "telemetry": self.telemetry.public(),
            "recovered_until": self.manager.cursors.get(self.runtime.station_id),
        }

    @callback
    def _call_changed(self) -> None:
        coordinator = self.runtime.coordinator
        current = coordinator.data.normalized if coordinator.last_update_success else None
        self.trace.call(current)
        # A ring already in progress at load/reconnect is not a new button press.
        if current == "ringing" and self._previous_call in {"idle", "in_call", "ending"}:
            loop = self.manager.hass.loop
            if loop.time() - self._last_ring >= 2:
                self._last_ring = loop.time()
                now = datetime.now(UTC).isoformat()
                self.manager.accept(
                    {
                        "id": hashlib.sha256(
                            f"{self.runtime.station_id}:{now}:ring".encode()
                        ).hexdigest(),
                        "station_id": self.runtime.station_id,
                        "timestamp": now,
                        "received_at": now,
                        "time_source": "received",
                        "employee_no": None,
                        "person_name": None,
                        "door": None,
                        "api_door": None,
                        "authentication": "unknown",
                        "result": "unknown",
                        "event_type": "ring",
                        "major": None,
                        "minor": None,
                        "card": None,
                        "recovered": False,
                        "source": "call_status",
                    }
                )
        self._previous_call = current

    def ingest(
        self, payload: dict[str, Any], *, historical: bool = False, occurrence: int = 0
    ) -> None:
        selected = self.runtime.locks[0].api_id if self.runtime.locks else None
        row = normalize_event(
            payload,
            self.runtime.station_id,
            self.manager.key,
            received=datetime.now(UTC),
            selected_api=selected,
            historical=historical,
            occurrence=occurrence,
        )
        resolved = False
        if row:
            # A matching central ID alone does not establish ownership on this station.
            if row["employee_no"] and not row["person_name"] and row["time_source"] == "device":
                name = self.runtime.access_manager.repository.event_person_name(
                    self.runtime.station_id, row["employee_no"], row["timestamp"]
                )
                if name:
                    row["person_name"] = name
                    resolved = True
            accepted = self.manager.accept(row)
            self.telemetry.observe(row, accepted)
        self.trace.event(payload, row, historical=historical, resolved=resolved)

    async def _stream(self) -> None:
        session = await self.manager.hass.async_add_executor_job(
            create_event_session, self.runtime.client.settings
        )
        delay = 2
        try:
            while not self._closed:
                try:
                    await self.runtime.client.async_confirm_identity()
                    # Renew healthy streams periodically; call polling has its own connection.
                    async with asyncio.timeout(1800):
                        frames = 0
                        started = self.manager.hass.loop.time()
                        async for document in self.client.async_stream(session):
                            self.stream_state = "connected"
                            self.last_frame_at = datetime.now(UTC).isoformat()
                            delay = 2
                            frames += 1
                            if frames > 1200 and self.manager.hass.loop.time() - started < 60:
                                raise HikvisionUnsupportedError("Event flood")
                            if self.manager.hass.loop.time() - started >= 60:
                                frames, started = 0, self.manager.hass.loop.time()
                            self.ingest(document)
                            await asyncio.sleep(0)
                    self.stream_state = "disconnected"
                except HikvisionAuthError:
                    self.stream_state, delay = "authentication_failed", 300
                except HikvisionUnsupportedError:
                    self.stream_state, delay = "unavailable", 300
                except (HikvisionError, TimeoutError):
                    self.stream_state = "disconnected"
                self.reconnects += 1
                await asyncio.sleep(
                    delay
                    + int(hashlib.sha256(self.runtime.station_id.encode()).hexdigest()[:2], 16)
                    / 255
                )
                delay = min(delay * 2, 300)
        finally:
            await session.aclose()

    async def _history(self) -> None:
        while not self._closed:
            try:
                if not self.runtime.coordinator.last_update_success:
                    self.history_state = "offline"
                elif not self.client.page_size and not await self.client.async_capabilities():
                    self.history_state = "unavailable"
                else:
                    await self.runtime.client.async_confirm_identity()
                    end = datetime.now(UTC).replace(microsecond=0) - timedelta(seconds=2)
                    saved = timestamp(self.manager.cursors.get(self.runtime.station_id))
                    start = max(saved or end - timedelta(days=1), end - timedelta(days=30))
                    if start >= end:
                        start = end - timedelta(minutes=5)
                    start = start.replace(microsecond=0)
                    end = min(end, start + timedelta(days=1))
                    # Narrow dense windows; never advance the cursor over omitted pages.
                    async with asyncio.timeout(120):
                        while True:
                            try:
                                rows = await self.client.async_history(
                                    start - timedelta(seconds=2), end
                                )
                                break
                            except HistoryWindowFull:
                                if (end - start).total_seconds() <= 1:
                                    raise
                                end = start + timedelta(
                                    seconds=max(1, int((end - start).total_seconds() / 2))
                                )
                    for row in rows:
                        when = timestamp(row.get("time"))
                        if when is None or when < start - timedelta(seconds=2) or when > end:
                            raise ValueError("History time filter was not honored")
                    occurrences: dict[str, int] = {}
                    for row in rows:
                        projected = normalize_event(
                            row,
                            self.runtime.station_id,
                            self.manager.key,
                            received=datetime.now(UTC),
                            selected_api=None,
                            historical=True,
                        )
                        if projected is None:
                            raise ValueError("Malformed historical event")
                        identity = projected["id"]
                        occurrence = occurrences.get(identity, 0)
                        occurrences[identity] = occurrence + 1
                        self.ingest(row, historical=True, occurrence=occurrence)
                        await asyncio.sleep(0)
                    self.manager.cursors[self.runtime.station_id] = end.isoformat()
                    self.history_state = "recovered"
                    self.manager.changed()
            except HikvisionAuthError:
                self.history_state = "authentication_failed"
            except HikvisionUnsupportedError:
                self.history_state = "unavailable"
            except (HikvisionError, TimeoutError, ValueError):
                # Keep the old cursor; incompleteness is visible and can be retried.
                self.history_state = "incomplete"
            caught_up = timestamp(self.manager.cursors.get(self.runtime.station_id))
            delay = 300
            if self.history_state in {"incomplete", "offline"}:
                delay = 60
            elif (
                self.history_state == "recovered"
                and caught_up
                and (datetime.now(UTC) - caught_up).total_seconds() > 310
            ):
                delay = 5
            await asyncio.sleep(delay)

    async def async_close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._unsubscribe()
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
        self.stream_state = "stopped"
        self.manager.stations.pop(self.runtime.station_id, None)


def get_events(hass: HomeAssistant) -> EventManager:
    return hass.data[DOMAIN]["events"]


async def async_setup_events(hass: HomeAssistant) -> None:
    if "events" in hass.data.setdefault(DOMAIN, {}):
        return
    manager = EventManager(hass)
    try:
        await manager.async_load()
    except (ValueError, KeyError, HikvisionError):
        issue(hass, "events_storage_corrupt", active=True)
        raise
    issue(hass, "events_storage_corrupt", active=False)
    hass.data[DOMAIN]["events"] = manager

    async def stop(_event: Any) -> None:
        await manager.async_close()

    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, stop)
