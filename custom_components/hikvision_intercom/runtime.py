"""Own each station session, polling lifecycle and selected momentary release."""

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
from .configuration import ManagedLock, PollOptions, managed_locks
from .const import DOMAIN, PLATFORMS
from .coordinator import IntercomCoordinator
from .exceptions import (
    HikvisionAuthError,
    HikvisionError,
    HikvisionUnsupportedError,
    HikvisionValidationError,
)


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
    unlocking: bool = False
    released: bool = False
    _cancel_pulse: Callable[[], None] | None = field(default=None, repr=False)

    async def async_unlock(self, physical_index: int) -> None:
        if self.session.is_closed:
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
        if self.unlocking:
            raise ServiceValidationError(
                translation_domain=DOMAIN, translation_key="release_in_progress"
            )
        self.unlocking = True
        self.coordinator.async_update_listeners()
        try:
            await self.client.async_unlock(selected.api_id)
        except HikvisionError:
            raise HomeAssistantError(
                translation_domain=DOMAIN, translation_key="release_unconfirmed"
            ) from None
        else:
            if self._cancel_pulse:
                self._cancel_pulse()
            self.released = True
            self._cancel_pulse = async_call_later(self.hass, self.pulse_seconds, self._finish_pulse)
        finally:
            self.unlocking = False
            self.coordinator.async_update_listeners()

    @callback
    def _finish_pulse(self, _now: datetime) -> None:
        self.released = False
        self._cancel_pulse = None
        self.coordinator.async_update_listeners()

    async def async_close(self) -> None:
        await self.access_manager.async_detach(self.station_id)
        if self._cancel_pulse:
            self._cancel_pulse()
            self._cancel_pulse = None
        await self.coordinator.async_shutdown()
        await self.session.aclose()


type IntercomConfigEntry = ConfigEntry[IntercomRuntime]


async def _async_reload(hass: HomeAssistant, entry: IntercomConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_setup_runtime(hass: HomeAssistant, entry: IntercomConfigEntry) -> bool:
    try:
        settings = ConnectionSettings.from_mapping(entry.data)
        locks = managed_locks(entry.data)
        options = PollOptions.from_mapping(entry.options)
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
    )
    coordinator = IntercomCoordinator(hass, entry, client)
    manager = get_manager(hass)
    manager.register(entry.entry_id, entry.title, bool(locks))
    try:
        profile = await client.async_profile()
        if profile.unique_id != entry.unique_id:
            raise ConfigEntryError(translation_domain=DOMAIN, translation_key="identity_changed")
        if any(lock.api_id not in profile.api_door_ids for lock in locks):
            raise ConfigEntryError(translation_domain=DOMAIN, translation_key="mapping_changed")
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
        if not locks:
            old = registry.async_get_entity_id("lock", DOMAIN, f"{entry.unique_id}_door_1")
            if old:
                registry.async_remove(old)
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
        manager.attach(entry.entry_id, AccessClient(client))
        was_online = coordinator.last_update_success

        @callback
        def recovered() -> None:
            nonlocal was_online
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
            if not isinstance(runtime, IntercomRuntime) or runtime.session.is_closed:
                raise ServiceValidationError(
                    translation_domain=DOMAIN, translation_key="target_unloaded"
                )
            if not runtime.locks or call.data["lock"] != 1:
                raise ServiceValidationError(
                    translation_domain=DOMAIN, translation_key="target_lock_not_managed"
                )
            targets.append(runtime)
        for runtime in targets:
            await runtime.async_unlock(1)

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
    if (type(value) is int and value == 1) or (type(value) is str and value == "1"):
        return 1
    raise vol.Invalid("Only physical lock 1 is managed")
