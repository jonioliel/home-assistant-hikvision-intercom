"""Own the central access repository once and expose administrator sync actions."""

from typing import Any

import voluptuous as vol
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import Event, HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.service import async_register_admin_service

from .access.manager import AccessManager
from .access.models import AccessError
from .access.repository import AccessRepository
from .configuration import managed_locks
from .const import DOMAIN
from .issues import issue
from .storage import AccessStore

SIGNAL_ACCESS_CHANGED = f"{DOMAIN}_access_changed"


def get_manager(hass: HomeAssistant) -> AccessManager:
    return hass.data[DOMAIN]["access"]


async def async_setup_access(hass: HomeAssistant) -> None:
    if DOMAIN in hass.data and "access" in hass.data[DOMAIN]:
        return
    store = AccessStore(hass)
    repository = AccessRepository(store.async_save)
    try:
        await repository.async_load(await store.async_load())
    except AccessError:
        issue(hass, "users_storage_corrupt", active=True)
        raise
    issue(hass, "users_storage_corrupt", active=False)

    @callback
    def changed() -> None:
        # The signal carries no personal data. Only administrator subscribers may project it.
        async_dispatcher_send(hass, SIGNAL_ACCESS_CHANGED)

    manager = AccessManager(
        repository,
        changed=changed,
        task_factory=lambda coro, name: hass.async_create_background_task(
            coro, name, eager_start=False
        ),
    )
    hass.data.setdefault(DOMAIN, {})["access"] = manager
    for entry in hass.config_entries.async_entries(DOMAIN):
        manager.register(entry.entry_id, entry.title, bool(managed_locks(entry.data)))

    async def stop(_event: Event) -> None:
        await manager.async_close()

    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, stop)
    _register_services(hass, manager)


@callback
def _register_services(hass: HomeAssistant, manager: AccessManager) -> None:
    async def action(call: ServiceCall) -> None:
        try:
            if call.service == "sync_all":
                manager.request_all()
            elif call.service == "rescan_station":
                await manager.async_rescan(call.data["station_id"])
            elif call.service == "sync_user":
                manager.request_user(call.data["user_id"])
            else:
                manager.request(call.data["station_id"])
        except AccessError as err:
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="access_action_failed",
                translation_placeholders={"reason": err.code},
            ) from None

    for name in ("sync_user", "sync_station", "sync_all", "rescan_station"):
        key = "user_id" if name == "sync_user" else "station_id"
        fields: dict[Any, Any] = {} if name == "sync_all" else {vol.Required(key): str}
        async_register_admin_service(hass, DOMAIN, name, action, vol.Schema(fields))
