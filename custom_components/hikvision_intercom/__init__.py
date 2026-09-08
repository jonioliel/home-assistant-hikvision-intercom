"""Hikvision Intercom integration; protocol tooling remains importable without HA."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

    from .runtime import IntercomConfigEntry


async def async_setup_entry(hass: HomeAssistant, entry: IntercomConfigEntry) -> bool:
    """Create and own the per-entry runtime."""
    from .runtime import async_setup_runtime

    return await async_setup_runtime(hass, entry)


async def async_unload_entry(hass: HomeAssistant, entry: IntercomConfigEntry) -> bool:
    """Unload platforms before closing their network resources."""
    from .runtime import async_unload_runtime

    return await async_unload_runtime(hass, entry)
