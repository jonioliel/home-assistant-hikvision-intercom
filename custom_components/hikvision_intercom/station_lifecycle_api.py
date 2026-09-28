"""Administrator-only, read-only station replacement/retirement reviews."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from homeassistant.core import HomeAssistant

from .access.diagnostics import error_code
from .access.models import AccessError, text_field
from .access.station_lifecycle import impact
from .access_runtime import get_manager
from .configuration import managed_locks
from .const import DOMAIN


async def review_lifecycle(hass: HomeAssistant, msg: dict, actor: str) -> dict:
    source = text_field(msg["source_id"], 64)
    target = text_field(msg["target_id"], 64, empty=True) or None
    if source == target:
        raise AccessError("invalid_fields")
    manager = get_manager(hass)
    stamp = manager.repository.bulk_stamp()
    definitions: dict[str, Any] = {}
    identities = {}
    locks = set()
    for sid in [source, *([target] if target else [])]:
        entry = hass.config_entries.async_get_entry(sid)
        if entry is None or entry.domain != DOMAIN or sid not in manager.stations:
            raise AccessError("station_not_found")
        mapped = managed_locks(entry.data)
        if sid == target:
            locks = {item.physical_index for item in mapped}
        runtime = getattr(entry, "runtime_data", None)
        identities[sid] = (entry, entry.unique_id, runtime)
        definition = {
            "id": sid,
            "name": entry.title,
            "identity_verified": False,
            "identity_checked_at": None,
            "error": "station_unloaded",
            "mappings": [
                {"physical_index": item.physical_index, "api_id": item.api_id, "name": item.name}
                for item in mapped
            ],
        }
        if runtime is not None and not runtime.is_closed:
            try:
                async with asyncio.timeout(20):
                    await runtime.client.async_confirm_identity()
                if getattr(entry, "runtime_data", None) is not runtime or runtime.is_closed:
                    raise AccessError("station_unloaded")
                definition.update(
                    identity_verified=True,
                    identity_checked_at=datetime.now(UTC).isoformat(),
                    error=None,
                )
            except Exception as err:
                definition["error"] = error_code(err)
        definitions[sid] = definition
    current = await hass.auth.async_get_user(actor)
    if not current or not current.is_active or not current.is_admin:
        raise AccessError("unauthorized")
    if manager._closed or manager.repository.bulk_stamp() != stamp:
        raise AccessError("bulk_review_stale")
    observed = manager.stations[source]
    result = await asyncio.to_thread(
        impact,
        manager.repository,
        source,
        target,
        target_locks=locks,
        source_inventory=observed.inventory,
        target_inventory=manager.stations[target].inventory if target else None,
        source_observed_at=observed.scanned_at,
        hold_programs=len(hass.data[DOMAIN]["hold_programs"].listing(source)),
    )
    # A read can finish after the account is revoked or definitions are replaced.
    current = await hass.auth.async_get_user(actor)
    if not current or not current.is_active or not current.is_admin:
        raise AccessError("unauthorized")
    if manager._closed or manager.repository.bulk_stamp() != stamp:
        raise AccessError("bulk_review_stale")
    for sid, definition in definitions.items():
        entry = hass.config_entries.async_get_entry(sid)
        expected_entry, expected_identity, expected_runtime = identities[sid]
        if (
            entry is not expected_entry
            or entry.unique_id != expected_identity
            or getattr(entry, "runtime_data", None) is not expected_runtime
            or entry.title != definition["name"]
        ):
            raise AccessError("bulk_review_stale")
        if (
            entry is None
            or entry.domain != DOMAIN
            or [
                {"physical_index": item.physical_index, "api_id": item.api_id, "name": item.name}
                for item in managed_locks(entry.data)
            ]
            != definition["mappings"]
        ):
            raise AccessError("bulk_review_stale")
    return {**result, "stations": list(definitions.values())}
