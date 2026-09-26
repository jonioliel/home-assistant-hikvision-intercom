"""Momentary release: displayed return is a timer, not a physical door sensor."""

from typing import Any

from homeassistant.components.lock import LockEntity, LockEntityFeature
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import DOMAIN
from .entity import IntercomEntity
from .runtime import IntercomConfigEntry


async def async_setup_entry(
    hass: HomeAssistant,
    entry: IntercomConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    if entry.runtime_data.locks:
        async_add_entities(
            [IntercomLock(entry, lock.physical_index) for lock in entry.runtime_data.locks]
        )


class IntercomLock(IntercomEntity, LockEntity):
    _attr_supported_features = LockEntityFeature.OPEN

    def __init__(self, entry: IntercomConfigEntry, physical_index: int = 1) -> None:
        super().__init__(entry, f"door_{physical_index}")
        self.physical_index = physical_index
        if name := next(
            lock.name for lock in self.runtime.locks if lock.physical_index == physical_index
        ):
            self._attr_name = name

    @property
    def is_locked(self) -> bool:
        return self.physical_index not in self.runtime.released_relays

    @property
    def is_unlocking(self) -> bool:
        return self.physical_index in self.runtime.unlocking_relays

    @property
    def extra_state_attributes(self) -> dict[str, str | float]:
        return {"state_source": "optimistic", "display_pulse_seconds": self.runtime.pulse_seconds}

    async def async_unlock(self, **kwargs: Any) -> None:
        await self.runtime.async_unlock(self.physical_index)

    async def async_open(self, **kwargs: Any) -> None:
        await self.async_unlock(**kwargs)

    async def async_lock(self, **kwargs: Any) -> None:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="forced_lock_unsupported"
        )
