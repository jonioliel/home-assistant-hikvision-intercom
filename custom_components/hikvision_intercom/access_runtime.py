"""Own the central access repository once and expose administrator sync actions."""

from typing import Any

import voluptuous as vol
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import Event, HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.service import async_register_admin_service

from .access.acceptance import Acceptance
from .access.manager import AccessManager
from .access.models import AccessError
from .access.repository import AccessRepository
from .access.schedule_baselines import ScheduleBaselines
from .access.schedule_journal import ScheduleJournal
from .access.schedule_operations import ScheduleOperations
from .access.schedule_plans import SchedulePlans
from .access.schedule_work_queue import ScheduleWorkQueue
from .access.schedules import ScheduleLibrary
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

    from .media_settings import MediaSettings

    media_store = AccessStore(hass, key=f"{DOMAIN}.media_settings")
    media = MediaSettings(media_store.async_save, changed)
    try:
        media.load(await media_store.async_load())
    except AccessError:
        issue(hass, "media_settings_storage_corrupt", active=True)
        hass.data.setdefault(DOMAIN, {})["media_settings"] = None
    else:
        issue(hass, "media_settings_storage_corrupt", active=False)
        hass.data.setdefault(DOMAIN, {})["media_settings"] = media

    from .profile_settings import ProfileSettings

    profile_store = AccessStore(hass, key=f"{DOMAIN}.profile_settings")
    profiles = ProfileSettings(profile_store.async_save, changed)
    # Do not silently discard corrupt field definitions or reuse their identities.
    try:
        profiles.load(await profile_store.async_load())
    except AccessError:
        issue(hass, "profile_settings_storage_corrupt", active=True)
        hass.data[DOMAIN]["profile_settings"] = None
    else:
        issue(hass, "profile_settings_storage_corrupt", active=False)
        hass.data[DOMAIN]["profile_settings"] = profiles

    schedule_store = AccessStore(hass, key=f"{DOMAIN}.schedules")
    schedules = ScheduleLibrary(schedule_store.async_save, changed)
    try:
        await schedules.async_load(await schedule_store.async_load())
    except AccessError:
        issue(hass, "schedules_storage_corrupt", active=True)
        hass.data.setdefault(DOMAIN, {})["schedules"] = None
    else:
        issue(hass, "schedules_storage_corrupt", active=False)
        hass.data.setdefault(DOMAIN, {})["schedules"] = schedules

    acceptance_store = AccessStore(hass, key=f"{DOMAIN}.acceptance")
    acceptance = Acceptance(acceptance_store.async_save)
    try:
        await acceptance.async_load(await acceptance_store.async_load())
    except AccessError:
        issue(hass, "acceptance_storage_corrupt", active=True)
        hass.data[DOMAIN]["acceptance"] = None
    else:
        issue(hass, "acceptance_storage_corrupt", active=False)
        hass.data[DOMAIN]["acceptance"] = acceptance

    baseline_store = AccessStore(hass, key=f"{DOMAIN}.schedule_baselines")
    baselines = ScheduleBaselines(baseline_store.async_save)
    try:
        await baselines.async_load(await baseline_store.async_load())
    except AccessError:
        issue(hass, "schedule_baselines_storage_corrupt", active=True)
        hass.data.setdefault(DOMAIN, {})["schedule_baselines"] = None
    else:
        issue(hass, "schedule_baselines_storage_corrupt", active=False)
        hass.data.setdefault(DOMAIN, {})["schedule_baselines"] = baselines

    plan_store = AccessStore(hass, key=f"{DOMAIN}.schedule_plans")
    plans = SchedulePlans(plan_store.async_save)
    try:
        await plans.async_load(await plan_store.async_load())
    except AccessError:
        issue(hass, "schedule_plans_storage_corrupt", active=True)
        hass.data.setdefault(DOMAIN, {})["schedule_plans"] = None
    else:
        issue(hass, "schedule_plans_storage_corrupt", active=False)
        hass.data.setdefault(DOMAIN, {})["schedule_plans"] = plans

    journal_store = AccessStore(hass, key=f"{DOMAIN}.schedule_journal")
    journal = ScheduleJournal(journal_store.async_save)
    operations_store = AccessStore(hass, key=f"{DOMAIN}.schedule_operations")
    operations = ScheduleOperations(operations_store.async_save)
    for key, database, persistence in (
        ("schedule_journal", journal, journal_store),
        ("schedule_operations", operations, operations_store),
    ):
        try:
            await database.async_load(await persistence.async_load())
        except AccessError:
            issue(hass, f"{key}_storage_corrupt", active=True)
            hass.data[DOMAIN][key] = None
        else:
            issue(hass, f"{key}_storage_corrupt", active=False)
            hass.data[DOMAIN][key] = database

    from .schedule_operations_api import preflight

    queue = ScheduleWorkQueue(
        operations,
        lambda job: preflight(hass, job),
        changed,
        lambda coro: hass.async_create_background_task(
            coro, "hikvision schedule preflight", eager_start=False
        ),
    )
    hass.data[DOMAIN]["schedule_queue"] = queue

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
        await queue.close()
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
