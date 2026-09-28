"""Visit preset API validates current relay configuration without device writes."""

from typing import Any

from homeassistant.core import HomeAssistant

from .access.guest_templates import normalize
from .access.models import AccessError
from .configuration import managed_locks
from .const import DOMAIN


async def dispatch_templates(
    hass: HomeAssistant, command: str, msg: dict[str, Any], actor: str
) -> dict[str, Any]:
    templates = hass.data[DOMAIN].get("guest_templates")
    if templates is None:
        raise AccessError("guest_templates_unavailable")
    if command == "guest_templates/get":
        return templates.public()
    if command == "guest_templates/delete":
        return await templates.delete(msg["revision"], msg["template_id"])
    values = normalize(msg["values"])
    for station_id, locks in values["doors"].items():
        entry = hass.config_entries.async_get_entry(station_id)
        if entry is None or entry.domain != DOMAIN:
            raise AccessError("station_not_found")
        configured = {lock.physical_index for lock in managed_locks(entry.data)}
        if not set(locks) <= configured:
            raise AccessError("unmanaged_lock")
    return await templates.upsert(msg["revision"], msg["template_id"], values, actor)
