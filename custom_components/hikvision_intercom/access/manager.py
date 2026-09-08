"""Fleet scheduling and explicit administrator workflows, independent of Home Assistant."""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from ..client.access import AccessClient, StationInventory, validate_identifier
from ..exceptions import (
    HikvisionAuthError,
    HikvisionBusyError,
    HikvisionConnectionError,
    HikvisionError,
    HikvisionTimeoutError,
    HikvisionUnsupportedError,
)
from .diagnostics import SAFE_ERRORS, SyncDiagnostics, error_code
from .engine import SyncEngine
from .models import (
    SYNC_STATES,
    AccessError,
    ManagedCard,
    ManagedUser,
    SecretValue,
    build_user,
    utc_now,
)
from .normalize import canonical, desired_cards, desired_person
from .repository import AccessRepository

TaskFactory = Callable[[Coroutine[Any, Any, None], str], asyncio.Task[None]]


@dataclass(slots=True, repr=False)
class Station:
    id: str
    name: str
    lock_enabled: bool
    driver: AccessClient | None = None
    inventory: StationInventory | None = None
    status: str = "offline"
    error: str | None = None
    scanned_at: str | None = None
    task: asyncio.Task[None] | None = None
    timer: asyncio.TimerHandle | None = None
    pending: bool = False
    failures: int = 0


class AccessManager:
    """Coalesce work per station; the engine serializes writes and caps fleet concurrency."""

    def __init__(
        self,
        repository: AccessRepository,
        *,
        changed: Callable[[], None] | None = None,
        task_factory: TaskFactory | None = None,
    ) -> None:
        self.repository = repository
        self._changed = changed or (lambda: None)
        self.diagnostics = SyncDiagnostics(repository.fingerprint)
        self.engine = SyncEngine(repository, changed=self._changed, diagnostics=self.diagnostics)
        self.stations: dict[str, Station] = {}
        self._read_slots = asyncio.Semaphore(3)
        self._task_factory = task_factory or (
            lambda coro, name: asyncio.create_task(coro, name=name)
        )
        self._closed = False

    def register(self, station_id: str, name: str, lock_enabled: bool) -> None:
        if station_id in self.stations:
            station = self.stations[station_id]
            station.name, station.lock_enabled = name, lock_enabled
        else:
            self.stations[station_id] = Station(station_id, name, lock_enabled)

    def attach(self, station_id: str, driver: AccessClient) -> None:
        station = self._station(station_id)
        if station.driver is not None:
            raise AccessError("station_already_attached")
        station.driver = driver
        station.status = "pending"
        self.request(station_id)

    async def async_detach(self, station_id: str) -> None:
        station = self._station(station_id)
        station.driver = None
        if station.timer:
            station.timer.cancel()
            station.timer = None
        if station.task:
            station.task.cancel()
            await asyncio.gather(station.task, return_exceptions=True)
            station.task = None
        station.driver, station.inventory, station.pending = None, None, False
        station.status, station.error = "offline", "station_unloaded"
        self._changed()

    async def async_close(self) -> None:
        self._closed = True
        await asyncio.gather(*(self.async_detach(key) for key in self.stations))

    def _station(self, station_id: str) -> Station:
        if station_id not in self.stations:
            raise AccessError("station_not_found")
        return self.stations[station_id]

    def _driver(self, station: Station) -> AccessClient:
        if station.driver is None:
            raise AccessError("station_offline")
        if not station.lock_enabled or not station.driver.client.enabled_doors:
            raise AccessError("station_has_no_managed_lock")
        return station.driver

    def request(self, station_id: str) -> None:
        station = self._station(station_id)
        if self._closed:
            raise AccessError("manager_closed")
        station.pending = True
        self.diagnostics.queued(station.id)
        if station.timer:
            station.timer.cancel()
            station.timer = None
        if station.driver is not None and station.task is None:
            station.task = self._task_factory(
                self._worker(station), "Hikvision access reconciliation"
            )
        self._changed()

    def has_access(self, station_id: str) -> bool:
        state = self.repository.snapshot()
        return (
            bool(state["bindings"].get(station_id))
            or any(
                user.active
                and station_id in user.assignments
                and user.assignments[station_id].enabled
                for user in self.repository.users()
            )
            or any(
                station_id in item["targets"] and station_id not in item["confirmed"]
                for item in state["tombstones"].values()
            )
        )

    def request_all(self) -> None:
        for key in self.stations:
            self.request(key)

    def request_user(self, user_id: str) -> None:
        state = self.repository.snapshot()
        if user_id not in state["users"] and user_id not in state["tombstones"]:
            raise AccessError("user_not_found")
        for key in self.stations:
            if user_id in self.engine.jobs(key):
                self.request(key)

    async def _mark_station(self, station: Station, status: str, error: str) -> None:
        station.status, station.error = status, error
        for user_id in self.engine.jobs(station.id):
            await self.repository.async_mark(station.id, user_id, status, error)

    async def _scan(self, station: Station) -> None:
        driver = station.driver
        if driver is None:
            raise AccessError("station_offline")
        async with self._read_slots:
            self.diagnostics.stage(station.id, None, "identity")
            await driver.client.async_confirm_identity()
            self.diagnostics.stage(station.id, None, "capabilities")
            await driver.async_capabilities()
            self.diagnostics.stage(station.id, None, "inventory")
            inventory = await driver.async_inventory()
            self.diagnostics.finish(station.id, None)
        station.inventory, station.scanned_at = inventory, utc_now()

    async def _worker(self, station: Station) -> None:
        retry = False
        try:
            while station.pending:
                station.pending = False
                station.status, station.error = "syncing", None
                self._changed()
                try:
                    await self._scan(station)
                    if self.engine.jobs(station.id):
                        if not station.lock_enabled:
                            raise AccessError("station_has_no_managed_lock")
                        result = await self.engine.async_reconcile(
                            station.id, self._driver(station)
                        )
                        retry = result.retry
                        station.error = result.last_error
                        station.status = (
                            "offline"
                            if result.offline
                            else "error"
                            if result.failed
                            else "pending"
                            if result.retry
                            else "synced"
                        )
                        if not result.offline:
                            await self._scan(station)
                    else:
                        station.status = "synced"
                    station.failures = station.failures + 1 if retry else 0
                except (HikvisionConnectionError, HikvisionTimeoutError) as err:
                    self.diagnostics.finish(station.id, None, error=err)
                    retry = True
                    station.failures += 1
                    await self._mark_station(station, "offline", "connection_failed")
                except HikvisionBusyError as err:
                    self.diagnostics.finish(station.id, None, error=err)
                    retry = True
                    station.failures += 1
                    await self._mark_station(station, "pending", "device_busy")
                except HikvisionAuthError as err:
                    self.diagnostics.finish(station.id, None, error=err)
                    await self._mark_station(station, "error", "authentication_failed")
                except HikvisionUnsupportedError as err:
                    self.diagnostics.finish(station.id, None, error=err)
                    await self._mark_station(station, "error", "operation_unsupported")
                except AccessError as err:
                    self.diagnostics.finish(station.id, None, error=err)
                    await self._mark_station(station, "error", err.code)
                except HikvisionError as err:
                    self.diagnostics.finish(station.id, None, error=err)
                    await self._mark_station(station, "error", error_code(err))
                except asyncio.CancelledError:
                    self.diagnostics.finish(station.id, None, outcome="cancelled")
                    raise
                except Exception as err:
                    self.diagnostics.finish(station.id, None, error=err)
                    # A storage failure must halt writes. Never log secret-bearing exceptions.
                    station.status, station.error = "error", "storage_or_internal_error"
                    break
                self._changed()
                if retry:
                    break
        finally:
            station.task = None
            if not self._closed and station.driver is not None:
                delay = min(300, 5 * 2 ** min(station.failures, 6)) if retry else 300
                station.timer = asyncio.get_running_loop().call_later(
                    delay, self.request, station.id
                )
            self._changed()

    def _validate(self, user: ManagedUser) -> None:
        for key, assignment in user.assignments.items():
            station = self._station(key)
            if not assignment.enabled or not user.active:
                continue
            if not station.lock_enabled:
                raise AccessError("station_has_no_managed_lock")
            if station.driver and (caps := station.driver.capabilities):
                desired_person(user, next(iter(station.driver.client.enabled_doors)), caps)
                desired_cards(user, caps)

    async def async_create(self, data: dict[str, Any]) -> dict[str, Any]:
        self._validate(build_user(data, employee_no="100000000", now=utc_now()))
        user = await self.repository.async_create(data)
        self.request_user(user.id)
        self._changed()
        return user.public()

    async def async_update(
        self, user_id: str, data: dict[str, Any], *, revision: int
    ) -> dict[str, Any]:
        previous = self.repository.get(user_id)
        self._validate(
            build_user(data, employee_no=previous.employee_no, now=utc_now(), previous=previous)
        )
        user = await self.repository.async_update(user_id, data, expected_revision=revision)
        self.request_user(user.id)
        self._changed()
        return user.public()

    async def async_delete(self, user_id: str, *, revision: int) -> None:
        await self.repository.async_delete(user_id, expected_revision=revision)
        # Users with no station targets are deleted immediately.
        for key in self.stations:
            if user_id in self.engine.jobs(key):
                self.request(key)
        self._changed()

    def public(self) -> dict[str, Any]:
        state = self.repository.snapshot()
        stations = []
        for station in self.stations.values():
            caps = station.driver.capabilities if station.driver else None
            inventory = station.inventory
            owned = {item["employee_no"] for item in state["bindings"].get(station.id, {}).values()}
            ignored = set(state["ignored"].get(station.id, []))
            stations.append(
                {
                    "id": station.id,
                    "sync_reference": self.diagnostics.reference(station.id),
                    "name": station.name,
                    "lock_enabled": station.lock_enabled,
                    "loaded": station.driver is not None,
                    "sync_state": station.status,
                    "last_error": station.error,
                    "scanned_at": station.scanned_at,
                    "user_count": len(inventory.users) if inventory else None,
                    "card_count": len(inventory.cards) if inventory else None,
                    "unmanaged_count": len(set(inventory.users) - owned - ignored)
                    if inventory
                    else None,
                    "capabilities": {
                        "max_users": caps.max_users,
                        "max_cards": caps.max_cards,
                        "cards_per_person": caps.cards_per_person,
                        "pin_mode": caps.pin_mode,
                        "pin_writable": caps.pin_field is not None,
                        "pin_min": caps.pin_min,
                        "pin_max": caps.pin_max,
                        "card_min": caps.card_min,
                        "card_max": caps.card_max,
                        "name_max": caps.name_max,
                        "schedules": False,
                    }
                    if caps
                    else None,
                }
            )
        public = self.repository.public()
        for user in public["users"]:
            user["sync_reference"] = self.diagnostics.reference(user["id"])
        return {**public, "stations": stations}

    def sync_diagnostics(self) -> dict[str, Any]:
        """A support export excludes host/title/person/employee/credential identifiers."""
        stations = []
        for station in self.stations.values():
            stations.append(
                {
                    "station_ref": self.diagnostics.reference(station.id),
                    "state": station.status if station.status in SYNC_STATES else "unknown",
                    "last_error": station.error
                    if station.error is None or station.error in SAFE_ERRORS
                    else "other",
                    "loaded": station.driver is not None,
                    "managed_lock": station.lock_enabled,
                    "worker_active": station.task is not None,
                    "pending_request": station.pending,
                    "reconciliation_targets": len(self.engine.jobs(station.id)),
                }
            )
        return {"stations": stations, **self.diagnostics.public()}

    async def async_inventory(self, station_id: str) -> list[dict[str, Any]]:
        station = self._station(station_id)
        await self._scan(station)
        driver = station.driver
        assert driver and driver.capabilities and station.inventory
        state = self.repository.snapshot()
        owned = {
            value["employee_no"]: key
            for key, value in state["bindings"].get(station_id, {}).items()
        }
        ignored = set(state["ignored"].get(station_id, []))
        rows = []
        for employee_no, raw in station.inventory.users.items():
            try:
                normal = canonical(station.inventory, employee_no, driver.capabilities)
                token = self.repository.fingerprint(normal)
                self._import_data(station, employee_no, station.inventory)
                import_error = None
            except AccessError as err:
                token, import_error = None, err.code
            rows.append(
                {
                    "employee_no": employee_no,
                    "display_name": raw.get("name", ""),
                    "user_id": owned.get(employee_no),
                    "ignored": employee_no in ignored,
                    "review_token": token,
                    "import_error": import_error,
                    "pin_configured": bool(raw.get(driver.capabilities.pin_field or "")),
                    "cards": [
                        ManagedCard(str(uuid4()), SecretValue(number)).public()
                        for number, card in station.inventory.cards.items()
                        if card["employeeNo"] == employee_no
                    ],
                }
            )
        self._changed()
        return rows

    def _import_data(
        self, station: Station, employee_no: str, inventory: StationInventory
    ) -> dict[str, Any]:
        driver = self._driver(station)
        caps = driver.capabilities
        assert caps is not None
        normal = canonical(inventory, employee_no, caps)
        raw, person = inventory.users.get(employee_no), normal["person"]
        if raw is None or person is None:
            raise AccessError("device_user_missing")
        if person["RightPlan"] != []:
            raise AccessError("schedule_unverified")
        if person["doorRight"] != str(next(iter(driver.client.enabled_doors))):
            raise AccessError("unmanaged_lock")
        if person["localUIRight"] is not False or any(
            raw.get(key, 0) for key in ("numOfFace", "numOfFP")
        ):
            raise AccessError("unsupported_credentials")
        if caps.pin_field is None:
            raise AccessError("pin_device_managed")
        valid = person["Valid"]
        if valid["enable"] and valid["timeType"] != "UTC":
            raise AccessError("local_validity_needs_conversion")
        return {
            "employee_no": employee_no,
            "display_name": person["name"],
            "user_type": person["userType"],
            "pin": person["pin"] or None,
            "valid_from": valid.get("beginTime"),
            "valid_until": valid.get("endTime"),
            "cards": [
                {"card_no": card["cardNo"], "card_type": card["cardType"]}
                for card in normal["cards"]
            ],
            "assignments": {station.id: {"allowed_locks": [1]}},
        }

    async def async_adopt(
        self,
        station_id: str,
        employee_no: str,
        *,
        review_token: str,
        user_id: str | None = None,
        revision: int | None = None,
        delete: bool = False,
    ) -> dict[str, Any]:
        validate_identifier(employee_no)
        station = self._station(station_id)
        driver = self._driver(station)
        async with driver.transaction():
            caps = await driver.async_capabilities()
            inventory = await driver.async_person(employee_no)
            fingerprint = self.repository.fingerprint(canonical(inventory, employee_no, caps))
            if not review_token or fingerprint != review_token:
                raise AccessError("review_stale")
            data = self._import_data(station, employee_no, inventory)
            if not delete:
                self._validate(build_user(data, employee_no=employee_no, now=utc_now()))
            user = await self.repository.async_adopt(
                station_id,
                data,
                fingerprint=fingerprint,
                existing_user_id=user_id,
                expected_revision=revision,
                delete=delete,
            )
        self.request_user(user.id)
        self._changed()
        return user.public()

    async def async_ignore(self, station_id: str, employee_no: str, *, ignored: bool) -> None:
        self._station(station_id)
        if type(ignored) is not bool:
            raise AccessError("invalid_boolean")
        await self.repository.async_ignore(station_id, employee_no, ignored=ignored)
        self._changed()

    async def async_resolve(
        self, station_id: str, user_id: str, *, review_token: str, revision: int, direction: str
    ) -> dict[str, Any]:
        if direction not in {"central", "device"}:
            raise AccessError("invalid_resolution")
        station = self._station(station_id)
        driver = self._driver(station)
        user = self.repository.get(user_id)
        async with driver.transaction():
            caps = await driver.async_capabilities()
            inventory = await driver.async_person(user.employee_no)
            fingerprint = self.repository.fingerprint(canonical(inventory, user.employee_no, caps))
            if not review_token or fingerprint != review_token:
                raise AccessError("review_stale")
            # Both directions require reviewable supported credentials; no hidden schedule takeover.
            data = (
                self._import_data(station, user.employee_no, inventory) if inventory.users else None
            )
            if direction == "device":
                if data is None:
                    raise AccessError("device_user_missing")
                data.pop("assignments")
                self._validate(
                    build_user(data, employee_no=user.employee_no, now=utc_now(), previous=user)
                )
            user = await self.repository.async_resolve(
                station_id,
                user_id,
                fingerprint=fingerprint,
                expected_revision=revision,
                device_data=data if direction == "device" else None,
            )
        self.request_user(user.id)
        self._changed()
        return user.public()

    async def async_review(self, station_id: str, user_id: str) -> dict[str, Any]:
        station = self._station(station_id)
        driver = self._driver(station)
        state = self.repository.snapshot()
        raw = state["users"].get(user_id)
        tombstone = state["tombstones"].get(user_id)
        if raw is None and tombstone is None:
            raise AccessError("user_not_found")
        employee_no = raw["employee_no"] if raw is not None else tombstone["employee_no"]
        async with driver.transaction():
            caps = await driver.async_capabilities()
            inventory = await driver.async_person(employee_no)
            normal = canonical(inventory, employee_no, caps)
            token = self.repository.fingerprint(normal)
        person = normal["person"]
        return {
            "user_id": user_id,
            "employee_no": employee_no,
            "station_id": station_id,
            "review_token": token,
            "absent": person is None,
            "display_name": person["name"] if person else None,
            "pin_configured": bool(person["pin"]) if person and caps.pin_field else None,
            "cards": [
                ManagedCard(str(uuid4()), SecretValue(card["cardNo"])).public()
                for card in normal["cards"]
            ],
            "deletion_pending": tombstone is not None,
        }

    async def async_resolve_deletion(
        self, station_id: str, user_id: str, *, review_token: str
    ) -> None:
        station = self._station(station_id)
        driver = self._driver(station)
        tombstone = self.repository.snapshot()["tombstones"].get(user_id)
        if tombstone is None:
            raise AccessError("deletion_not_pending")
        employee_no = tombstone["employee_no"]
        async with driver.transaction():
            caps = await driver.async_capabilities()
            inventory = await driver.async_person(employee_no)
            fingerprint = self.repository.fingerprint(canonical(inventory, employee_no, caps))
            if not review_token or fingerprint != review_token:
                raise AccessError("review_stale")
            if inventory.users:
                self._import_data(station, employee_no, inventory)
            await self.repository.async_resolve_deletion(
                station_id, user_id, fingerprint=fingerprint
            )
        self.request(station_id)
