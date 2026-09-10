"""Expose exact call enums without guessing unanswered transitions."""

from datetime import datetime

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .access.models import SYNC_STATES
from .access_runtime import SIGNAL_ACCESS_CHANGED, get_manager
from .const import CALL_STATES
from .entity import IntercomEntity
from .runtime import IntercomConfigEntry


async def async_setup_entry(
    hass: HomeAssistant,
    entry: IntercomConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    async_add_entities(
        [
            IntercomCallStatus(entry),
            *(
                IntercomSyncSensor(entry, key)
                for key in ("managed_users", "pending_users", "sync_health", "last_reconciled")
            ),
        ]
    )


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


class IntercomSyncSensor(IntercomEntity, SensorEntity):
    """Central sync diagnostics stay meaningful while a station is offline."""

    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_entity_registry_enabled_default = False

    def __init__(self, entry: IntercomConfigEntry, key: str) -> None:
        super().__init__(entry, key)
        self._station_id = entry.entry_id
        self._key = key
        self._metrics: dict | None = None
        if key == "sync_health":
            self._attr_device_class = SensorDeviceClass.ENUM
            self._attr_options = sorted(SYNC_STATES | {"unknown"})
        elif key == "last_reconciled":
            self._attr_device_class = SensorDeviceClass.TIMESTAMP

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(
            async_dispatcher_connect(self.hass, SIGNAL_ACCESS_CHANGED, self._refresh_metrics)
        )
        self._refresh_metrics()

    @callback
    def _refresh_metrics(self) -> None:
        self._metrics = get_manager(self.hass).station_metrics(self._station_id)
        self.async_write_ha_state()

    @property
    def available(self) -> bool:
        return self._metrics is not None and not self.runtime.is_closed

    @property
    def native_value(self) -> int | str | datetime | None:
        value = self._metrics.get(self._key) if self._metrics else None
        if self._key == "last_reconciled" and value:
            return datetime.fromisoformat(value)
        return value

    @property
    def extra_state_attributes(self) -> dict[str, str | None]:
        if self._key == "managed_users":
            return {
                "inventory_sampled_at": self._metrics.get("inventory_sampled_at")
                if self._metrics
                else None
            }
        return {}
