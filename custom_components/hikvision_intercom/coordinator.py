"""One bounded call-status poller shared by all entities of a station."""

import hashlib
import logging
from datetime import timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .client.client import CallState, HikvisionClient
from .const import DEFAULT_ACTIVE_INTERVAL, DEFAULT_IDLE_INTERVAL
from .exceptions import HikvisionAuthError, HikvisionError

_LOGGER = logging.getLogger(__name__)


class IntercomCoordinator(DataUpdateCoordinator[CallState]):
    def __init__(
        self, hass: HomeAssistant, entry: ConfigEntry[Any], client: HikvisionClient
    ) -> None:
        self.client = client
        self.idle_interval = float(entry.options.get("idle_interval", DEFAULT_IDLE_INTERVAL))
        self.active_interval = float(entry.options.get("active_interval", DEFAULT_ACTIVE_INTERVAL))
        self.failures = 0
        self.jitter = hashlib.sha256(entry.entry_id.encode()).digest()[0] / 2550
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name="Hikvision call status",
            update_interval=timedelta(seconds=self.idle_interval + self.jitter),
            always_update=False,
        )

    async def _async_update_data(self) -> CallState:
        try:
            state = await self.client.async_call_status()
        except HikvisionAuthError as err:
            raise ConfigEntryAuthFailed("Intercom authentication failed") from err
        except HikvisionError as err:
            self.failures = min(self.failures + 1, 6)
            self.update_interval = timedelta(
                seconds=min(60, self.idle_interval * 2**self.failures) + self.jitter
            )
            raise UpdateFailed("Intercom status could not be read") from err
        self.failures = 0
        interval = (
            self.active_interval
            if state.normalized in {"ringing", "in_call", "ending"}
            else self.idle_interval
        )
        self.update_interval = timedelta(seconds=interval + self.jitter)
        return state
