"""Use HA's camera proxy and stream pipeline; keep source credentials on backend."""

from homeassistant.components.camera import Camera, CameraEntityFeature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .entity import IntercomEntity
from .exceptions import HikvisionError
from .runtime import IntercomConfigEntry


async def async_setup_entry(
    hass: HomeAssistant,
    entry: IntercomConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    if entry.runtime_data.profile.snapshot or entry.runtime_data.profile.stream:
        async_add_entities([IntercomCamera(entry)])


class IntercomCamera(IntercomEntity, Camera):
    def __init__(self, entry: IntercomConfigEntry) -> None:
        Camera.__init__(self)
        IntercomEntity.__init__(self, entry, "camera")
        if self.runtime.profile.stream:
            self._attr_supported_features = CameraEntityFeature.STREAM

    async def async_camera_image(
        self, width: int | None = None, height: int | None = None
    ) -> bytes | None:
        if not self.runtime.profile.snapshot:
            return None
        try:
            return await self.runtime.client.async_snapshot()
        except HikvisionError:
            return None

    async def stream_source(self) -> str | None:
        return self.runtime.client.settings.rtsp_source() if self.runtime.profile.stream else None
