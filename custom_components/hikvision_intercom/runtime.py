"""Own each station session, polling lifecycle and selected momentary release."""

import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime

import httpx
import voluptuous as vol
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import Event, HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import (
    ConfigEntryAuthFailed,
    ConfigEntryError,
    ConfigEntryNotReady,
    HomeAssistantError,
    ServiceValidationError,
)
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_call_later
from homeassistant.helpers.service import (
    async_extract_config_entry_ids,
    async_register_admin_service,
)

from .access.manager import AccessManager
from .access_runtime import get_manager
from .client.access import AccessClient
from .client.client import ConnectionSettings, HikvisionClient, StationProfile, create_session
from .clock import named_zone
from .clock_runtime import StationClock
from .configuration import ManagedLock, PollOptions, managed_locks
from .const import DOMAIN, PLATFORMS
from .coordinator import IntercomCoordinator
from .event_manager import StationEvents, get_events
from .exceptions import (
    HikvisionAuthError,
    HikvisionError,
    HikvisionUnsupportedError,
    HikvisionValidationError,
)
from .issues import issue


@dataclass(slots=True)
class IntercomRuntime:
    hass: HomeAssistant
    client: HikvisionClient
    session: httpx.AsyncClient
    coordinator: IntercomCoordinator
    profile: StationProfile
    locks: tuple[ManagedLock, ...]
    pulse_seconds: float
    access_manager: AccessManager
    station_id: str
    events: StationEvents | None = None
    clock: StationClock | None = None
    unlocking_relays: set[int] = field(default_factory=set)
    released_relays: set[int] = field(default_factory=set)
    relay_timers: dict[int, Callable[[], None]] = field(default_factory=dict)
    unlocking: bool = False
    released: bool = False
    _closing: bool = field(default=False, init=False, repr=False)

    @property
    def is_closed(self) -> bool:
        """Stop accepting work before asynchronous cleanup starts."""
        return self._closing or self.session.is_closed

    async def async_unlock(self, physical_index: int) -> None:
        if self.is_closed:
            raise ServiceValidationError(
                translation_domain=DOMAIN, translation_key="connection_closed"
            )
        selected = next(
            (lock for lock in self.locks if lock.physical_index == physical_index), None
        )
        if type(physical_index) is not int or selected is None:
            raise ServiceValidationError(
                translation_domain=DOMAIN, translation_key="lock_not_managed"
            )
        if physical_index in self.unlocking_relays:
            raise ServiceValidationError(
                translation_domain=DOMAIN, translation_key="release_in_progress"
            )
        self.unlocking_relays.add(physical_index)
        self.unlocking = bool(self.unlocking_relays)
        self.coordinator.async_update_listeners()
        try:
            await self.client.async_unlock(selected.api_id)
        except HikvisionError:
            raise HomeAssistantError(
                translation_domain=DOMAIN, translation_key="release_unconfirmed"
            ) from None
        else:
            if self.is_closed:
                # The command may have reached the station. Never replay it or
                # revive a pulse after this runtime started shutting down.
                raise HomeAssistantError(
                    translation_domain=DOMAIN, translation_key="release_unconfirmed"
                )
            previous_timer = self.relay_timers.pop(physical_index, None)
            if previous_timer:
                previous_timer()
            self.released_relays.add(physical_index)
            self.released = bool(self.released_relays)

            @callback
            def finish(now: datetime) -> None:
                self._finish_relay(physical_index, now)

            self.relay_timers[physical_index] = async_call_later(
                self.hass, self.pulse_seconds, finish
            )
        finally:
            self.unlocking_relays.discard(physical_index)
            self.unlocking = bool(self.unlocking_relays)
            if not self.is_closed:
                self.coordinator.async_update_listeners()

    @callback
    def _finish_relay(self, physical_index: int, _now: datetime) -> None:
        self.relay_timers.pop(physical_index, None)
        self.released_relays.discard(physical_index)
        self.released = bool(self.released_relays)
        if not self.is_closed:
            self.coordinator.async_update_listeners()

    async def async_close(self) -> None:
        self._closing = True
        for cancel in self.relay_timers.values():
            cancel()
        self.relay_timers.clear()
        self.released_relays.clear()
        self.released = False
        data = self.hass.data.get(DOMAIN, {})
        bridge = data.get("audio_sessions", {}).get(self.station_id)
        if bridge and bridge.runtime is self:
            bridge.cancel()
            if bridge.task:
                await asyncio.gather(bridge.task, return_exceptions=True)
        operation = data.get("call_operations", {}).get(self.station_id)
        if operation and operation[0] is self:
            operation[1].cancel()
            await asyncio.gather(operation[1], return_exceptions=True)
        results = data.get("call_results", {})
        if self.station_id in results and results[self.station_id][0] is self:
            results.pop(self.station_id, None)
        audio_results = data.get("audio_results", {})
        if self.station_id in audio_results and audio_results[self.station_id][0] is self:
            audio_results.pop(self.station_id, None)
        if self.clock:
            await self.clock.async_close()
        if self.events:
            await self.events.async_close()
        await self.access_manager.async_detach(self.station_id)
        await self.coordinator.async_shutdown()
        await self.session.aclose()
        cache = self.hass.data.get(DOMAIN, {}).get("media_evidence", {})
        if self.station_id in cache and cache[self.station_id][0] is self:
            cache.pop(self.station_id, None)


type IntercomConfigEntry = ConfigEntry[IntercomRuntime]


async def _async_reload(hass: HomeAssistant, entry: IntercomConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_setup_runtime(hass: HomeAssistant, entry: IntercomConfigEntry) -> bool:
    try:
        settings = ConnectionSettings.from_mapping(entry.data)
        locks = managed_locks(entry.data)
        options = PollOptions.from_mapping(entry.options)
        mode = entry.options.get("display_time_zone", "device")
        if mode not in {"device", "manual"}:
            raise HikvisionValidationError("Invalid display time zone source")
        manual = (
            await hass.async_add_executor_job(named_zone, entry.options.get("manual_time_zone"))
            if mode == "manual"
            else None
        )
    except (HikvisionValidationError, KeyError):
        raise ConfigEntryError(
            translation_domain=DOMAIN, translation_key="invalid_configuration"
        ) from None
    session = await hass.async_add_executor_job(create_session, settings)
    client = HikvisionClient(
        session,
        settings,
        enabled_doors=frozenset(lock.api_id for lock in locks),
        expected_identity=entry.unique_id,
        physical_doors={lock.physical_index: lock.api_id for lock in locks},
    )
    coordinator = IntercomCoordinator(hass, entry, client)
    manager = get_manager(hass)
    manager.register(entry.entry_id, entry.title, bool(locks))
    try:
        profile = await client.async_profile()
        if profile.unique_id != entry.unique_id:
            issue(hass, "identity", active=True, entry_id=entry.entry_id)
            raise ConfigEntryError(translation_domain=DOMAIN, translation_key="identity_changed")
        if any(lock.api_id not in profile.api_door_ids for lock in locks):
            issue(hass, "relay_mapping", active=True, entry_id=entry.entry_id)
            raise ConfigEntryError(translation_domain=DOMAIN, translation_key="mapping_changed")
        issue(hass, "identity", active=False, entry_id=entry.entry_id)
        issue(hass, "relay_mapping", active=False, entry_id=entry.entry_id)
        baseline = entry.data.get("capability_baseline")
        observed = {
            "snapshot": profile.snapshot,
            "stream": profile.stream,
            "call_states": list(profile.call_states),
        }
        if baseline is None:
            hass.config_entries.async_update_entry(
                entry, data={**entry.data, "capability_baseline": observed}
            )
        regression = isinstance(baseline, dict) and (
            any(baseline.get(key) is True and not observed[key] for key in ("snapshot", "stream"))
            or any(
                value not in profile.call_states
                for value in baseline.get("call_states", [])
                if value in {"idle", "ring", "onCall"}
            )
        )
        issue(hass, "capability_regression", active=regression, entry_id=entry.entry_id)
        await coordinator.async_config_entry_first_refresh()
        entry.runtime_data = IntercomRuntime(
            hass,
            client,
            session,
            coordinator,
            profile,
            locks,
            options.pulse,
            manager,
            entry.entry_id,
        )
        registry = er.async_get(hass)
        for index in {1, 2} - {lock.physical_index for lock in locks}:
            old = registry.async_get_entity_id("lock", DOMAIN, f"{entry.unique_id}_door_{index}")
            if old:
                registry.async_remove(old)
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
        manager.attach(entry.entry_id, AccessClient(client))
        entry.runtime_data.events = get_events(hass).attach(entry.runtime_data)
        runtime = entry.runtime_data
        was_online = coordinator.last_update_success

        @callback
        def recovered() -> None:
            nonlocal was_online
            if runtime.is_closed or entry.runtime_data is not runtime:
                return
            online = coordinator.last_update_success
            if online and not was_online:
                manager.request(entry.entry_id)
            was_online = online

        entry.async_on_unload(coordinator.async_add_listener(recovered))
    except BaseException as err:
        await manager.async_detach(entry.entry_id)
        await coordinator.async_shutdown()
        await session.aclose()
        if isinstance(err, HikvisionAuthError):
            raise ConfigEntryAuthFailed(
                translation_domain=DOMAIN, translation_key="authentication_failed"
            ) from None
        if isinstance(err, HikvisionUnsupportedError):
            raise ConfigEntryError(
                translation_domain=DOMAIN, translation_key="unsupported_device"
            ) from None
        if isinstance(err, HikvisionError):
            raise ConfigEntryNotReady(
                translation_domain=DOMAIN, translation_key="connection_failed"
            ) from None
        raise

    async def stop(_event: Event) -> None:
        await entry.runtime_data.async_close()

    entry.async_on_unload(hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, stop))
    entry.runtime_data.clock = StationClock(hass, client, manual)
    entry.runtime_data.clock.start()
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


async def async_unload_runtime(hass: HomeAssistant, entry: IntercomConfigEntry) -> bool:
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    await entry.runtime_data.async_close()
    return True


@callback
def async_register_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, "unlock_door"):
        return

    async def unlock(call: ServiceCall) -> None:
        ids = await async_extract_config_entry_ids(call)
        if not ids:
            raise ServiceValidationError(
                translation_domain=DOMAIN, translation_key="target_required"
            )
        targets: list[IntercomRuntime] = []
        for entry_id in ids:
            entry = hass.config_entries.async_get_entry(entry_id)
            if entry is None or entry.domain != DOMAIN:
                raise ServiceValidationError(
                    translation_domain=DOMAIN, translation_key="invalid_target"
                )
            runtime = getattr(entry, "runtime_data", None)
            if not isinstance(runtime, IntercomRuntime) or runtime.is_closed:
                raise ServiceValidationError(
                    translation_domain=DOMAIN, translation_key="target_unloaded"
                )
            if call.data["lock"] not in {lock.physical_index for lock in runtime.locks}:
                raise ServiceValidationError(
                    translation_domain=DOMAIN, translation_key="target_lock_not_managed"
                )
            targets.append(runtime)
        for runtime in targets:
            await runtime.async_unlock(call.data["lock"])

    async_register_admin_service(
        hass,
        DOMAIN,
        "unlock_door",
        unlock,
        vol.Schema(
            {
                **cv.ENTITY_SERVICE_FIELDS,
                vol.Required("lock", default=1): _physical_lock,
            }
        ),
    )


def _physical_lock(value: object) -> int:
    """Accept the UI's string selection or exact integer; never coerce booleans/floats."""
    if (type(value) is int and value in {1, 2}) or (type(value) is str and value in {"1", "2"}):
        return int(value)
    raise vol.Invalid("Invalid physical relay")
