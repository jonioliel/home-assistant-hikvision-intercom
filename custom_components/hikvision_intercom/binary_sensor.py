"""Connection and observed ringing state."""

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .entity import IntercomEntity
from .runtime import IntercomConfigEntry


async def async_setup_entry(
    hass: HomeAssistant,
    entry: IntercomConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    async_add_entities([IntercomOnline(entry), IntercomRinging(entry)])


class IntercomOnline(IntercomEntity, BinarySensorEntity):
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_available = True

    def __init__(self, entry: IntercomConfigEntry) -> None:
        super().__init__(entry, "online")

    @property
    def available(self) -> bool:
        return True

    @property
    def is_on(self) -> bool:
        return self.coordinator.last_update_success


class IntercomRinging(IntercomEntity, BinarySensorEntity):
    def __init__(self, entry: IntercomConfigEntry) -> None:
        super().__init__(entry, "ringing")

    @property
    def is_on(self) -> bool:
        return self.coordinator.data.normalized == "ringing"
