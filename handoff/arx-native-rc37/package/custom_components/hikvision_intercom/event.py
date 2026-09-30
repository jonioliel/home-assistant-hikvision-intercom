"""Momentary events exposed through Home Assistant's native event entity API."""

from homeassistant.components.event import EventDeviceClass, EventEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .entity import IntercomEntity
from .event_manager import SIGNAL_EVENT
from .events import EVENT_TYPES
from .runtime import IntercomConfigEntry


async def async_setup_entry(
    hass: HomeAssistant, entry: IntercomConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([IntercomEvent(entry, "doorbell"), IntercomEvent(entry, "access")])


class IntercomEvent(IntercomEntity, EventEntity):
    def __init__(self, entry: IntercomConfigEntry, key: str) -> None:
        super().__init__(entry, key)
        self.key = key
        self._attr_event_types = ["ring"] if key == "doorbell" else EVENT_TYPES
        if key == "doorbell":
            self._attr_device_class = EventDeviceClass.DOORBELL

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_EVENT, self._receive))

    @callback
    def _receive(self, row: dict) -> None:
        if row["station_id"] != self.runtime.station_id or (row["event_type"] == "ring") != (
            self.key == "doorbell"
        ):
            return
        self._trigger_event(
            row["event_type"],
            {
                key: row[key]
                for key in (
                    "employee_no",
                    "person_name",
                    "door",
                    "authentication",
                    "result",
                    "major",
                    "minor",
                )
            },
        )
        self.async_write_ha_state()
