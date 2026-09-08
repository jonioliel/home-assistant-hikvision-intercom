"""Expose exact call enums without guessing unanswered transitions."""

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import CALL_STATES
from .entity import IntercomEntity
from .runtime import IntercomConfigEntry


async def async_setup_entry(
    hass: HomeAssistant,
    entry: IntercomConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    async_add_entities([IntercomCallStatus(entry)])


class IntercomCallStatus(IntercomEntity, SensorEntity):
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = list(CALL_STATES)

    def __init__(self, entry: IntercomConfigEntry) -> None:
        super().__init__(entry, "call_status")

    @property
    def native_value(self) -> str:
        return self.coordinator.data.normalized

    @property
    def extra_state_attributes(self) -> dict[str, str]:
        return {"raw_state": self.coordinator.data.raw}
