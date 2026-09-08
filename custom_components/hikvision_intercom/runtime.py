"""Own each station session, polling lifecycle and selected momentary release."""

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime

import httpx
import voluptuous as vol
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
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

from .client.client import ConnectionSettings, HikvisionClient, StationProfile, create_session
from .configuration import ManagedLock, managed_locks
from .const import DEFAULT_PULSE_SECONDS, DOMAIN, PLATFORMS
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
    unlocking: bool = False
    released: bool = False
    _cancel_pulse: Callable[[], None] | None = field(default=None, repr=False)

    async def async_unlock(self, physical_index: int) -> None:
        selected = next(
            (lock for lock in self.locks if lock.physical_index == physical_index), None
        )
        if type(physical_index) is not int or selected is None:
            raise ServiceValidationError("This lock is not managed")
        if self.unlocking:
            raise ServiceValidationError("A release is already in progress")
        self.unlocking = True
        self.coordinator.async_update_listeners()
        try:
            await self.client.async_unlock(selected.api_id)
        except HikvisionError:
            raise HomeAssistantError(
                "The intercom did not confirm release; check the door before retrying"
            ) from None
        else:
            if self._cancel_pulse:
                self._cancel_pulse()
            self.released = True
            self._cancel_pulse = async_call_later(self.hass, self.pulse_seconds, self._finish_pulse)
        finally:
            self.unlocking = False
            self.coordinator.async_update_listeners()

    def _finish_pulse(self, _now: datetime) -> None:
        self.released = False
        self._cancel_pulse = None
        self.coordinator.async_update_listeners()

    async def async_close(self) -> None:
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
    except (HikvisionValidationError, KeyError):
        raise ConfigEntryError(
            "Invalid saved intercom configuration; reconfigure the station"
        ) from None
    session = await hass.async_add_executor_job(create_session, settings)
    client = HikvisionClient(
        session, settings, enabled_doors=frozenset(lock.api_id for lock in locks)
    )
    coordinator = IntercomCoordinator(hass, entry, client)
    try:
        profile = await client.async_profile()
        if profile.unique_id != entry.unique_id:
            raise ConfigEntryError(
                "The address belongs to a different intercom; reconfigure this entry"
            )
        if any(lock.api_id not in profile.api_door_ids for lock in locks):
            raise ConfigEntryError(
                "The confirmed relay is no longer advertised; reconfigure this entry"
            )
        await coordinator.async_config_entry_first_refresh()
        entry.runtime_data = IntercomRuntime(
            hass,
            client,
            session,
            coordinator,
            profile,
            locks,
            float(entry.options.get("pulse_seconds", DEFAULT_PULSE_SECONDS)),
        )
        registry = er.async_get(hass)
        if not locks:
            old = registry.async_get_entity_id("lock", DOMAIN, f"{entry.unique_id}_door_1")
            if old:
                registry.async_remove(old)
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    except BaseException as err:
        await coordinator.async_shutdown()
        await session.aclose()
        if isinstance(err, HikvisionAuthError):
            raise ConfigEntryAuthFailed("Intercom authentication failed") from None
        if isinstance(err, HikvisionUnsupportedError):
            raise ConfigEntryError("Unsupported intercom model or core endpoint") from None
        if isinstance(err, HikvisionError):
            raise ConfigEntryNotReady("Intercom could not be reached or validated") from None
        raise
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    async_register_services(hass)
    return True


async def async_unload_runtime(hass: HomeAssistant, entry: IntercomConfigEntry) -> bool:
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    await entry.runtime_data.async_close()
    others = [
        other
        for other in hass.config_entries.async_entries(DOMAIN)
        if other.entry_id != entry.entry_id
        and hasattr(other, "runtime_data")
        and not other.runtime_data.session.is_closed
    ]
    if not others:
        hass.services.async_remove(DOMAIN, "unlock_door")
    return True


def async_register_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, "unlock_door"):
        return

    async def unlock(call: ServiceCall) -> None:
        ids = await async_extract_config_entry_ids(call)
        if not ids:
            raise ServiceValidationError("Select an intercom device or entity")
        targets: list[IntercomRuntime] = []
        for entry_id in ids:
            entry = hass.config_entries.async_get_entry(entry_id)
            if entry is None or entry.domain != DOMAIN:
                raise ServiceValidationError("Target must belong to a Hikvision intercom")
            runtime = getattr(entry, "runtime_data", None)
            if not isinstance(runtime, IntercomRuntime) or runtime.session.is_closed:
                raise ServiceValidationError("Target intercom is not loaded")
            if not runtime.locks or call.data["lock"] != 1:
                raise ServiceValidationError("Target lock is not managed")
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
                vol.Required("lock", default=1): vol.All(vol.Coerce(int), vol.In([1])),
            }
        ),
    )
