"""An allowlist excludes connection data, raw device payloads and access identities."""

from typing import Any

from homeassistant.core import HomeAssistant

from .const import VERSION
from .runtime import IntercomConfigEntry


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: IntercomConfigEntry
) -> dict[str, Any]:
    runtime = getattr(entry, "runtime_data", None)
    result: dict[str, Any] = {
        "integration_version": VERSION,
        "loaded": runtime is not None and not runtime.session.is_closed,
    }
    if runtime is not None:
        result.update(
            {
                "model": "DS-KV6124-E1",
                "camera": {"snapshot": runtime.profile.snapshot, "stream": runtime.profile.stream},
                "managed_locks": [lock.physical_index for lock in runtime.locks],
                "online": runtime.coordinator.last_update_success,
                "consecutive_poll_failures": runtime.coordinator.failures,
            }
        )
    return result
