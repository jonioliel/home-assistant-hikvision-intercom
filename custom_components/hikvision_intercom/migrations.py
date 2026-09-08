"""Explicit, non-destructive migration of the existing config-entry layout."""

from homeassistant.core import HomeAssistant

from .client.client import ConnectionSettings
from .configuration import PollOptions, managed_locks
from .exceptions import HikvisionValidationError
from .issues import issue
from .runtime import IntercomConfigEntry


async def async_migrate_entry(hass: HomeAssistant, entry: IntercomConfigEntry) -> bool:
    # Unknown future layouts must never be silently downgraded or have permissions guessed.
    if entry.version != 1 or entry.minor_version > 2:
        issue(hass, "migration", active=True, entry_id=entry.entry_id)
        return False
    try:
        ConnectionSettings.from_mapping(entry.data)
        managed_locks(entry.data)
        PollOptions.from_mapping(entry.options)
    except (HikvisionValidationError, KeyError, TypeError):
        issue(hass, "migration", active=True, entry_id=entry.entry_id)
        return False
    if entry.minor_version < 2:
        # Version 1.2 adds optional observed capability baseline; no relay is enabled here.
        hass.config_entries.async_update_entry(entry, version=1, minor_version=2)
    issue(hass, "migration", active=False, entry_id=entry.entry_id)
    return True
