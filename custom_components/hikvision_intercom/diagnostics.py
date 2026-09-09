"""Private-free diagnostic projection for support and capacity planning."""

from typing import Any

from homeassistant.core import HomeAssistant

from .access.diagnostics import SAFE_ERRORS
from .access.models import SYNC_STATES
from .const import DOMAIN, VERSION
from .hardening import firmware_label
from .runtime import IntercomConfigEntry


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: IntercomConfigEntry
) -> dict[str, Any]:
    runtime = getattr(entry, "runtime_data", None)
    result: dict[str, Any] = {
        "integration_version": VERSION,
        "loaded": runtime is not None and not runtime.is_closed,
        "config_schema": {"version": entry.version, "minor_version": entry.minor_version},
    }
    if runtime is None:
        return result
    result.update(
        {
            "model": "DS-KV6124-E1",
            "firmware": firmware_label(runtime.profile.firmware),
            "camera": {"snapshot": runtime.profile.snapshot, "stream": runtime.profile.stream},
            "managed_locks": [lock.physical_index for lock in runtime.locks],
            "api_door_ids": list(runtime.profile.api_door_ids),
            "call_states": [
                state
                for state in runtime.profile.call_states
                if state in {"idle", "ring", "onCall"}
            ],
            "online": not runtime.is_closed and runtime.coordinator.last_update_success,
            "consecutive_poll_failures": runtime.coordinator.failures,
            "requests": runtime.client.metrics.public(),
        }
    )
    manager = runtime.access_manager
    station = manager.stations.get(entry.entry_id)
    if station:
        errors: dict[str, int] = {}
        states: dict[str, int] = {}
        for user in manager.repository.users():
            assignment = user.assignments.get(entry.entry_id)
            if assignment:
                state = assignment.sync_state if assignment.sync_state in SYNC_STATES else "unknown"
                states[state] = states.get(state, 0) + 1
                if assignment.last_error:
                    error = (
                        assignment.last_error if assignment.last_error in SAFE_ERRORS else "other"
                    )
                    errors[error] = errors.get(error, 0) + 1
        caps = station.driver.capabilities if station.driver else None
        result["access"] = {
            "sync_state": station.status if station.status in SYNC_STATES else "unknown",
            "last_error": station.error
            if station.error in SAFE_ERRORS
            else "other"
            if station.error
            else None,
            "pending_request": station.pending,
            "worker_active": station.task is not None,
            "queue_depth": len(manager.engine.jobs(entry.entry_id)),
            "assignment_states": states,
            "errors": errors,
            "users": len(station.inventory.users) if station.inventory else None,
            "cards": len(station.inventory.cards) if station.inventory else None,
            "capabilities": {
                "max_users": caps.max_users,
                "max_cards": caps.max_cards,
                "cards_per_person": caps.cards_per_person,
                "pin_writable": caps.pin_field is not None,
                "pin_min": caps.pin_min,
                "pin_max": caps.pin_max,
            }
            if caps
            else None,
        }
    result["sync_diagnostics"] = manager.diagnostics.public(entry.entry_id)
    events = runtime.events
    if events:
        result["events"] = {
            key: value for key, value in events.status().items() if key != "recovered_until"
        }
        event_manager = hass.data.get(DOMAIN, {}).get("events")
        if event_manager:
            result["events"].update(
                cached_records=len(event_manager.cache.rows),
                storage_failed=event_manager.storage_failed,
            )
    return result
