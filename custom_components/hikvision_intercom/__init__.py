"""Hikvision Intercom integration; protocol tooling remains importable without HA."""

from __future__ import annotations

from importlib.util import find_spec
from typing import TYPE_CHECKING

from .const import DOMAIN

# Standalone protocol tools intentionally do not require installing HA.
if find_spec("homeassistant") is not None:
    from homeassistant.helpers.config_validation import config_entry_only_config_schema

    CONFIG_SCHEMA = config_entry_only_config_schema(DOMAIN)

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant
    from homeassistant.helpers.typing import ConfigType

    from .runtime import IntercomConfigEntry


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register integration actions once, independent of individual station lifetimes."""
    from .access_runtime import async_setup_access
    from .panel import async_setup_panel
    from .runtime import async_register_services
    from .websocket import async_register_websocket

    await async_setup_access(hass)
    async_register_websocket(hass)
    await async_setup_panel(hass)
    async_register_services(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: IntercomConfigEntry) -> bool:
    """Create and own the per-entry runtime."""
    from .runtime import async_setup_runtime

    return await async_setup_runtime(hass, entry)


async def async_unload_entry(hass: HomeAssistant, entry: IntercomConfigEntry) -> bool:
    """Unload platforms before closing their network resources."""
    from .runtime import async_unload_runtime

    return await async_unload_runtime(hass, entry)
