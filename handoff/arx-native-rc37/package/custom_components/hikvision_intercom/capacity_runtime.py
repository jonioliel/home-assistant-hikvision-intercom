"""Sample cached complete inventory; never open a connection to collect a trend."""

from datetime import UTC, datetime
from hashlib import sha256

from homeassistant.core import HomeAssistant

from .access.models import AccessError
from .capacity_history import CapacityHistory
from .const import DOMAIN
from .issues import issue
from .operations_center import canonical
from .storage import AccessStore


async def setup(hass: HomeAssistant) -> None:
    store = AccessStore(hass, key=f"{DOMAIN}.capacity_history")
    history = CapacityHistory(store.async_save)
    try:
        history.load(await store.async_load())
    except AccessError:
        hass.data[DOMAIN]["capacity_history"] = None
        issue(hass, "capacity_history_storage_corrupt", active=True)
        return
    hass.data[DOMAIN]["capacity_history"] = history
    issue(hass, "capacity_history_storage_corrupt", active=False)


async def observe(hass: HomeAssistant) -> None:
    history = hass.data[DOMAIN].get("capacity_history")
    manager = hass.data[DOMAIN].get("access")
    if not isinstance(history, CapacityHistory) or manager is None:
        return
    observations = {}
    for sid, station in manager.stations.items():
        entry = hass.config_entries.async_get_entry(sid)
        runtime = getattr(entry, "runtime_data", None) if entry and entry.domain == DOMAIN else None
        if (
            runtime is None
            or runtime.is_closed
            or station.driver is None
            or station.driver.client is not runtime.client
            or station.inventory is None
            or station.scanned_at is None
            or station.scan_error
            or station.driver.capabilities is None
        ):
            continue
        caps = station.driver.capabilities
        observations[sid] = {
            "at": station.scanned_at,
            "identity_stamp": sha256(
                canonical(
                    {
                        "identity": runtime.profile.unique_id,
                        "firmware": runtime.profile.firmware,
                        "max_users": caps.max_users,
                        "max_cards": caps.max_cards,
                    }
                )
            ).hexdigest(),
            "users": len(station.inventory.users),
            "cards": len(station.inventory.cards),
            "max_users": caps.max_users,
            "max_cards": caps.max_cards,
        }
    await history.observe(observations, datetime.now(UTC))
