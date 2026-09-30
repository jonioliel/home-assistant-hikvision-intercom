"""Shared station identity and coordinator subscription."""

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import IntercomCoordinator
from .runtime import IntercomConfigEntry


class IntercomEntity(CoordinatorEntity[IntercomCoordinator]):
    _attr_has_entity_name = True

    def __init__(self, entry: IntercomConfigEntry, key: str) -> None:
        super().__init__(entry.runtime_data.coordinator)
        self.runtime = entry.runtime_data
        self._attr_unique_id = f"{entry.unique_id}_{key}"
        self._attr_translation_key = key
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.unique_id or entry.entry_id)},
            name=entry.title,
            manufacturer="Hikvision",
            model=self.runtime.profile.model,
            sw_version=self.runtime.profile.firmware,
        )
