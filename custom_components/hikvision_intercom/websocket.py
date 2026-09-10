"""Administrator-only panel API; every response projects explicit safe fields."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .access.admin_audit import audit_actor
from .access.models import AccessError
from .access.schedule_assessment import assess
from .access.schedule_baselines import ScheduleBaselines
from .access.schedules import ScheduleLibrary, preview
from .access.schedules import normalize as normalize_schedule
from .access_runtime import SIGNAL_ACCESS_CHANGED, get_manager
from .admin_operations_api import dispatch_admin
from .client.schedule_dependencies import inspect_dependencies
from .client.schedule_inventory import inspect_inventory
from .client.schedule_readiness import inspect_readiness as inspect_schedules
from .configuration import managed_locks
from .const import DOMAIN, VERSION
from .event_manager import get_events
from .exceptions import HikvisionError, HikvisionValidationError
from .hardening import AdminLimiter
from .health_api import dispatch_health
from .log_filter import install_filter
from .schedule_operations_api import dispatch_operations
from .schedule_plan_api import dispatch_plans

_LOGGER = logging.getLogger(__name__)
USER_FIELDS = {
    "permission_overrides",
    "access_policy_revision",
    "profile",
    "group_ids",
    "photo",
    "employee_no",
    "display_name",
    "active",
    "user_type",
    "valid_from",
    "valid_until",
    "pin",
    "cards",
    "assignments",
}
CARD_FIELDS = {"id", "card_no", "label", "card_type", "enabled"}
COMMANDS = {
    "profiles/settings_get": {},
    "profiles/settings_update": {"revision": int, "values": dict},
    "profiles/settings_preview": {"revision": int, "values": dict},
    "profiles/settings_apply": {"operation_id": str},
    "users/photo_get": {"user_id": str},
    "media/settings_get": {},
    "media/settings_update": {"revision": int, "values": dict},
    "media/provider_check": {},
    "media/provider_discover": {},
    "permissions/directory": {"filters": dict},
    "users/bulk_preview": {"request": dict},
    "users/bulk_apply": {"operation_id": str},
    "users/bulk_receipt": {"operation_id": str},
    "users/bulk_receipts": {},
    "audit/list": {"filters": dict},
    "audit/export": {"filters": dict},
    "stations/permission_audit": {"station_id": str},
    "health/get": {"station_id": str},
    "health/refresh": {"station_id": str},
    "acceptance/get": {"station_id": str},
    "acceptance/update": {"station_id": str, "step": str, "state": str, "revision": int},
    "events/history_inspect": {"station_id": str, "start": str, "end": str},
    "events/trace_start": {"station_id": str},
    "events/trace_get": {"station_id": str},
    "events/trace_stop": {"station_id": str, "capture_id": str},
    "media/call": {"station_id": str},
    "media/signal": {"station_id": str, "command": str},
    "schedules/operations_list": {},
    "schedules/operations_export": {},
    "schedules/operations_claim_preview": {"plan_id": str, "revision": int},
    "schedules/operations_claim_confirm": {"token": str},
    "schedules/operations_claim_release": {"claim_id": str, "revision": int},
    "schedules/operations_create": {"plan_id": str, "revision": int},
    "schedules/operations_check": {"job_id": str, "revision": int},
    "schedules/operations_cancel": {"job_id": str, "revision": int},
    "schedules/operations_archive": {"job_id": str, "revision": int},
    "schedules/plan_list": {},
    "schedules/plan_preview": {
        "station_id": str,
        "schedule_id": str,
        "revision": int,
        "bindings": dict,
    },
    "schedules/plan_save": {"token": str},
    "schedules/plan_recheck": {"plan_id": str, "revision": int},
    "schedules/plan_delete": {"plan_id": str, "revision": int},
    "schedules/plan_export": {"plan_id": str, "revision": int},
    "schedules/list": {},
    "schedules/export": {},
    "schedules/import_preview": {"document": str},
    "schedules/import_apply": {"token": str},
    "schedules/create": {"data": dict},
    "schedules/update": {"schedule_id": str, "revision": int, "data": dict},
    "schedules/delete": {"schedule_id": str, "revision": int},
    "schedules/preview": {"data": dict, "date": str, "time": str},
    "schedules/readiness": {"station_id": str},
    "schedules/dependencies": {"station_id": str},
    "schedules/assess": {"station_id": str, "data": dict},
    "schedules/baseline_save": {"station_id": str, "token": str},
    "schedules/baseline_clear": {"station_id": str, "revision": int},
    "cards/reader_capabilities": {"station_id": str},
    "cards/capture_start": {"station_id": str, "user_id": str, "revision": int, "reader_id": int},
    "cards/capture_status": {"session_id": str},
    "cards/capture_cancel": {"session_id": str},
    "cards/capture_confirm": {"session_id": str, "label": str},
    "overview": {},
    "events/list": {"filters": dict},
    "events/detail": {"event_id": str},
    "events/support": {"event_id": str},
    "users/list": {},
    "users/csv_export": {},
    "users/csv_preview": {"csv": str, "mode": str},
    "users/csv_apply": {"csv": str, "mode": str, "review_token": str},
    "events/report": {"filters": dict},
    "events/export": {"filters": dict},
    "users/get": {"user_id": str},
    "users/create": {"data": dict},
    "users/update": {"user_id": str, "revision": int, "data": dict},
    "users/delete": {"user_id": str, "revision": int},
    "users/set_active": {"user_id": str, "revision": int, "active": bool},
    "cards/add": {"user_id": str, "revision": int, "data": dict},
    "cards/remove": {"user_id": str, "revision": int, "card_id": str},
    "stations/clock_refresh": {"station_id": str},
    "stations/list": {},
    "stations/get": {"station_id": str},
    "stations/test_unlock": {"station_id": str, "lock": int},
    "stations/rescan": {"station_id": str},
    "stations/inventory": {"station_id": str},
    "users/adopt": {"station_id": str, "employee_no": str, "review_token": str},
    "users/delete_unmanaged": {"station_id": str, "employee_no": str, "review_token": str},
    "users/ignore": {"station_id": str, "employee_no": str, "ignored": bool},
    "sync/user": {"user_id": str},
    "sync/station": {"station_id": str},
    "sync/all": {},
    "sync/status": {},
    "sync/diagnostics": {},
    "conflicts/list": {},
    "conflicts/review": {"station_id": str, "user_id": str},
    "conflicts/resolve": {
        "station_id": str,
        "user_id": str,
        "review_token": str,
        "revision": int,
        "direction": str,
    },
    "conflicts/resolve_deletion": {"station_id": str, "user_id": str, "review_token": str},
}


def _patch(data: dict[str, Any]) -> dict[str, Any]:
    if set(data) - USER_FIELDS:
        raise AccessError("invalid_fields")
    if "cards" in data:
        if not isinstance(data["cards"], list) or any(
            not isinstance(card, dict) or set(card) - CARD_FIELDS for card in data["cards"]
        ):
            raise AccessError("invalid_fields")
    return data


def overview(hass: HomeAssistant) -> dict[str, Any]:
    data = get_manager(hass).public()
    registry = er.async_get(hass)
    latest_access = get_events(hass).latest_access({station["id"] for station in data["stations"]})
    for station in data["stations"]:
        entry = hass.config_entries.async_get_entry(station["id"])
        runtime = getattr(entry, "runtime_data", None) if entry else None
        station["entities"] = {
            item.domain: item.entity_id
            for item in er.async_entries_for_config_entry(registry, station["id"])
            if item.domain in {"camera", "lock"} and not item.disabled
        }
        if entry:
            for key in ("call_status", "online", "ringing"):
                platform = "sensor" if key == "call_status" else "binary_sensor"
                entity = registry.async_get_entity_id(platform, DOMAIN, f"{entry.unique_id}_{key}")
                if entity:
                    station["entities"][key] = entity
        station["clock"] = runtime.clock.public() if runtime and runtime.clock else None
        station["observations"] = {
            "call_status": bool(runtime and runtime.coordinator.last_seen),
            "snapshot": bool(runtime and runtime.profile.snapshot),
            "video_channel": bool(runtime and runtime.profile.stream),
            "user_info": station["capabilities"] is not None,
            "card_info": station["capabilities"] is not None,
            "event_query": bool(runtime and runtime.events and runtime.events.client.page_size),
        }
        try:
            locks = managed_locks(entry.data) if entry else ()
        except HikvisionValidationError:
            locks = ()
        station["integrated_locks"] = [
            {
                "physical_index": lock.physical_index,
                "api_id": lock.api_id,
                **({"name": lock.name} if lock.name else {}),
            }
            for lock in locks
        ]
        station["event_status"] = runtime.events.status() if runtime and runtime.events else None
        station.update(
            online=bool(
                runtime and not runtime.is_closed and runtime.coordinator.last_update_success
            ),
            call_state=runtime.coordinator.data.normalized
            if runtime and not runtime.is_closed and runtime.coordinator.last_update_success
            else "unavailable",
            last_seen=runtime.coordinator.last_seen.isoformat()
            if runtime and runtime.coordinator.last_seen
            else None,
            last_poll_ms=runtime.coordinator.last_poll_ms if runtime else None,
            last_access=latest_access.get(station["id"]),
            model=runtime.profile.model if runtime else None,
            firmware=runtime.profile.firmware if runtime else None,
            host=entry.data.get("host") if entry else None,
        )
    data["default_zone"] = {"kind": "iana", "name": hass.config.time_zone}
    media = hass.data[DOMAIN].get("media_settings")
    data["media_settings"] = media.public() if media else None
    profiles = hass.data[DOMAIN].get("profile_settings")
    data["profile_settings"] = profiles.public() if profiles else None
    data["version"] = VERSION
    return data


async def _dispatch(
    hass: HomeAssistant, command: str, msg: dict[str, Any], *, actor: str = ""
) -> Any:
    with audit_actor(actor, command):
        return await _dispatch_inner(hass, command, msg, actor=actor)


async def _dispatch_inner(
    hass: HomeAssistant, command: str, msg: dict[str, Any], *, actor: str = ""
) -> Any:
    if command.startswith(("users/bulk_", "audit/")) or command in {
        "stations/permission_audit",
        "permissions/directory",
        "profiles/settings_preview",
        "profiles/settings_apply",
    }:
        return await dispatch_admin(hass, command, msg, actor)
    manager = get_manager(hass)
    if command == "events/history_inspect":
        from .client.history_diagnostics import inspect_history

        station = manager._station(msg["station_id"])
        entry = hass.config_entries.async_get_entry(station.id)
        runtime = getattr(entry, "runtime_data", None)
        if runtime is None or runtime.is_closed:
            raise AccessError("station_unloaded")
        reads = hass.data[DOMAIN].setdefault("history_inspections", set())
        if station.id in reads or len(reads) >= 3:
            raise AccessError("device_busy")
        reads.add(station.id)
        try:
            report = await inspect_history(runtime.client, msg["start"], msg["end"])
            if getattr(entry, "runtime_data", None) is not runtime or runtime.is_closed:
                raise AccessError("station_unloaded")
            return report
        finally:
            reads.discard(station.id)
    if command in {
        "media/settings_get",
        "media/settings_update",
        "media/provider_check",
        "media/provider_discover",
    }:
        from .media_api import dispatch_media

        return await dispatch_media(hass, command, msg)
    if command.startswith(("health/", "acceptance/", "media/")):
        return await dispatch_health(hass, command, msg)
    if command.startswith("events/trace_"):
        station_events = get_events(hass).stations.get(msg["station_id"])
        if station_events is None or station_events._closed:
            raise AccessError("station_unloaded")
        trace = station_events.trace
        if command == "events/trace_start":
            coordinator = station_events.runtime.coordinator
            initial = (
                coordinator.data.normalized if coordinator.last_update_success else "unavailable"
            )
            return trace.start(initial)
        if command == "events/trace_stop":
            return trace.stop(msg["capture_id"])
        return trace.public()
    if command in {"events/detail", "events/support"}:
        return get_events(hass).detail(msg["event_id"], export=command == "events/support")
    if command == "cards/reader_capabilities":
        return await manager.enrollment.capabilities(msg["station_id"])
    if command.startswith("cards/capture_"):
        if not actor:
            raise AccessError("unauthorized")
        enrollment = manager.enrollment
        if command == "cards/capture_start":
            return enrollment.start(
                msg["station_id"], msg["user_id"], msg["revision"], msg["reader_id"], actor
            )
        if command == "cards/capture_status":
            return enrollment.status(msg["session_id"], actor)
        if command == "cards/capture_cancel":
            await enrollment.cancel(msg["session_id"], actor)
            return {"cancelled": True}
        return await enrollment.confirm(msg["session_id"], actor, msg["label"])
    if command.startswith("schedules/operations_"):
        return await dispatch_operations(hass, command, msg, actor)
    if command.startswith("schedules/plan_"):
        return await dispatch_plans(hass, command, msg, actor)
    if command.startswith("schedules/"):
        baselines = hass.data[DOMAIN].get("schedule_baselines")
        if command in {"schedules/baseline_save", "schedules/baseline_clear"}:
            if not isinstance(baselines, ScheduleBaselines):
                raise AccessError("schedule_baseline_unavailable")
            station = manager._station(msg["station_id"])
            if command == "schedules/baseline_clear":
                return await baselines.async_clear(station.id, msg["revision"])
            driver = manager._driver(station)
            entry = hass.config_entries.async_get_entry(station.id)
            runtime = getattr(entry, "runtime_data", None)
            identity = baselines.fingerprint(
                [driver.client._expected_identity, runtime.profile.firmware if runtime else None]
            )
            return await baselines.async_save(station.id, actor, identity, msg["token"])
        if command in {"schedules/readiness", "schedules/assess", "schedules/dependencies"}:
            draft = normalize_schedule(msg["data"]) if command == "schedules/assess" else None
            station = manager._station(msg["station_id"])
            driver = manager._driver(station)
            busy = hass.data[DOMAIN].setdefault("schedule_reads", set())
            if station.id in busy or len(busy) >= 3:
                raise AccessError("schedule_read_busy")
            busy.add(station.id)
            evidence: dict[str, Any] = {}
            try:
                async with asyncio.timeout(130 if command == "schedules/dependencies" else 70):
                    async with manager._read_slots:
                        result = (
                            await inspect_dependencies(driver.client)
                            if command == "schedules/dependencies"
                            else await inspect_inventory(
                                driver.client,
                                evidence=evidence,
                                fingerprint=baselines.fingerprint
                                if isinstance(baselines, ScheduleBaselines)
                                else None,
                            )
                            if draft is not None
                            else await inspect_schedules(driver.client)
                        )
                if station.driver is not driver or manager._closed:
                    raise AccessError("station_unloaded")
                if draft is not None:
                    result["assessment"] = assess(draft, result)
                    result["baseline"] = {
                        "state": "unavailable",
                        "revision": 0,
                        "checked_at": None,
                        "token": None,
                        "checks": [],
                    }
                    if isinstance(baselines, ScheduleBaselines) and evidence:
                        entry = hass.config_entries.async_get_entry(station.id)
                        runtime = getattr(entry, "runtime_data", None)
                        identity = baselines.fingerprint(
                            [
                                driver.client._expected_identity,
                                runtime.profile.firmware if runtime else None,
                            ]
                        )
                        result["baseline"] = baselines.observe(
                            station.id, actor, identity, result["checked_at"], evidence
                        )
                return result
            except TimeoutError:
                raise AccessError("connection_failed") from None
            finally:
                busy.discard(station.id)
        library = hass.data[DOMAIN].get("schedules")
        if not isinstance(library, ScheduleLibrary):
            raise AccessError("invalid_storage")
        if command == "schedules/export":
            return library.export()
        if command == "schedules/import_preview":
            return library.preview_import(msg["document"], actor)
        if command == "schedules/import_apply":
            return await library.async_import(msg["token"], actor)
        if command == "schedules/list":
            return library.list()
        if command == "schedules/create":
            return await library.async_save(msg["data"])
        if command == "schedules/update":
            return await library.async_save(
                msg["data"], schedule_id=msg["schedule_id"], revision=msg["revision"]
            )
        if command == "schedules/delete":
            await library.async_delete(msg["schedule_id"], msg["revision"])
            return {"deleted": True}
        return preview(msg["data"], msg["date"], msg["time"])
    if command == "stations/clock_refresh":
        entry = hass.config_entries.async_get_entry(msg["station_id"])
        runtime = getattr(entry, "runtime_data", None) if entry and entry.domain == DOMAIN else None
        if runtime is None or runtime.clock is None or runtime.is_closed:
            raise AccessError("station_offline")
        await runtime.clock.async_refresh()
        return runtime.clock.public()
    if command == "sync/diagnostics":
        return {"integration_version": VERSION, **manager.sync_diagnostics()}
    if command in {"events/report", "events/export"}:
        try:
            return await get_events(hass).async_report(
                msg["filters"], export=command == "events/export"
            )
        except HikvisionValidationError:
            raise AccessError("invalid_fields") from None
    if command == "users/csv_export":
        return await manager.async_export_csv()
    if command == "users/csv_preview":
        return await manager.async_preview_csv(msg["csv"], msg["mode"])
    if command == "users/csv_apply":
        return await manager.async_import_csv(
            msg["csv"], msg["mode"], review_token=msg["review_token"]
        )
    if command == "events/list":
        try:
            return get_events(hass).query(msg["filters"])
        except HikvisionValidationError:
            raise AccessError("invalid_fields") from None
    if command in {"overview", "sync/status"}:
        return overview(hass)
    if command == "users/list":
        return manager.repository.public()["users"]
    if command in {"profiles/settings_get", "profiles/settings_update", "users/photo_get"}:
        profile_settings = hass.data[DOMAIN].get("profile_settings")
        if profile_settings is None:
            raise AccessError("profile_settings_unavailable")
        if command == "profiles/settings_get":
            return profile_settings.public()
        if command == "profiles/settings_update":
            from .profile_settings import normalize

            values = normalize(msg["values"])
            previous = {
                g["id"]: set(g.get("station_ids", [])) for g in profile_settings.public()["groups"]
            }
            for group in values["groups"]:
                for station_id in set(group.get("station_ids", [])) - previous.get(
                    group["id"], set()
                ):
                    station = manager.stations.get(station_id)
                    if station is None:
                        raise AccessError("station_not_found")
                    if not station.lock_enabled:
                        raise AccessError("unmanaged_lock")
            return await profile_settings.update(msg["revision"], msg["values"])
        if not profile_settings.public()["photo_enabled"]:
            return {"photo": None}
        return {"photo": manager.repository.get(msg["user_id"]).photo}
    if command == "users/get":
        return manager.repository.get(msg["user_id"]).public()
    if command in {"users/create", "users/update"} and {
        "profile",
        "group_ids",
        "photo",
    }.intersection(msg["data"]):
        patch = msg["data"]
        profile_settings = hass.data[DOMAIN].get("profile_settings")
        if profile_settings is None:
            raise AccessError("profile_settings_unavailable")
        definitions = profile_settings.public()
        if "profile" in patch and (
            not isinstance(patch["profile"], dict)
            or set(patch["profile"]) - {f["id"] for f in definitions["fields"]}
        ):
            raise AccessError("invalid_fields")
        if "group_ids" in patch and (
            not isinstance(patch["group_ids"], list)
            or any(
                not isinstance(g, str) or g not in {v["id"] for v in definitions["groups"]}
                for g in patch["group_ids"]
            )
        ):
            raise AccessError("invalid_fields")
        if patch.get("photo") is not None and not definitions["photo_enabled"]:
            raise AccessError("photo_disabled")
    if command == "users/create":
        return await manager.async_create(_patch(msg["data"]), sync_now=msg.get("sync_now", True))
    if command in {"users/update", "users/set_active", "cards/add", "cards/remove"}:
        patch = msg.get("data", {})
        if command == "users/set_active":
            patch = {"active": msg["active"]}
        if command.startswith("cards/"):
            user = manager.repository.get(msg["user_id"])
            cards = [
                {"id": card.id, "label": card.label, "enabled": card.enabled} for card in user.cards
            ]
            if command == "cards/add":
                if set(patch) - CARD_FIELDS or "card_no" not in patch or "id" in patch:
                    raise AccessError("invalid_fields")
                cards.append(patch)
            else:
                if not any(card["id"] == msg["card_id"] for card in cards):
                    raise AccessError("card_not_found")
                cards = [card for card in cards if card["id"] != msg["card_id"]]
            patch = {"cards": cards}
        return await manager.async_update(
            msg["user_id"],
            _patch(patch),
            revision=msg["revision"],
            sync_now=msg.get("sync_now", True),
        )
    if command == "users/delete":
        await manager.async_delete(msg["user_id"], revision=msg["revision"])
    elif command == "stations/list":
        return overview(hass)["stations"]
    elif command == "stations/get":
        station = next(
            (item for item in overview(hass)["stations"] if item["id"] == msg["station_id"]), None
        )
        if station is None:
            raise AccessError("station_not_found")
        return station
    elif command == "stations/test_unlock":
        entry = hass.config_entries.async_get_entry(msg["station_id"])
        if (
            entry is None
            or entry.domain != DOMAIN
            or not (runtime := getattr(entry, "runtime_data", None))
        ):
            raise AccessError("station_offline")
        if not runtime.coordinator.last_update_success:
            raise AccessError("station_offline")
        try:
            await runtime.async_unlock(msg["lock"])
        except HomeAssistantError as err:
            # Preserve known release outcomes without exposing device/exception text.
            key = err.translation_key
            code = (
                key
                if err.translation_domain == DOMAIN
                and key
                in {
                    "release_in_progress",
                    "release_unconfirmed",
                    "connection_closed",
                    "lock_not_managed",
                }
                else "action_failed"
            )
            raise AccessError(code) from None
    elif command == "stations/inventory":
        return await manager.async_inventory(msg["station_id"])
    elif command in {"users/adopt", "users/delete_unmanaged"}:
        return await manager.async_adopt(
            msg["station_id"],
            msg["employee_no"],
            review_token=msg["review_token"],
            user_id=msg.get("user_id"),
            revision=msg.get("revision"),
            delete=command.endswith("delete_unmanaged"),
        )
    elif command == "users/ignore":
        await manager.async_ignore(msg["station_id"], msg["employee_no"], ignored=msg["ignored"])
    elif command == "conflicts/list":
        data = manager.repository.public()
        return {
            "users": [
                user
                for user in data["users"]
                if any(
                    item["sync_state"] in {"conflict", "error"}
                    for item in user["assignments"].values()
                )
            ],
            "tombstones": data["tombstones"],
            "revocations": data["revocations"],
        }
    elif command == "conflicts/review":
        return await manager.async_review(msg["station_id"], msg["user_id"])
    elif command == "conflicts/resolve":
        return await manager.async_resolve(
            msg["station_id"],
            msg["user_id"],
            review_token=msg["review_token"],
            revision=msg["revision"],
            direction=msg["direction"],
        )
    elif command == "conflicts/resolve_deletion":
        await manager.async_resolve_deletion(
            msg["station_id"], msg["user_id"], review_token=msg["review_token"]
        )
    elif command == "stations/rescan":
        await manager.async_rescan(msg["station_id"])
    elif command == "sync/station":
        manager.request(msg["station_id"])
    elif command == "sync/user":
        manager.request_user(msg["user_id"])
    elif command == "sync/all":
        manager.request_all()
    else:
        raise AccessError("unknown_command")
    return {"accepted": True}


def _command_handler(command: str, fields: dict[str, type]) -> Callable[..., None]:
    schema = vol.Schema(
        {
            vol.Required("id"): int,
            vol.Required("type"): str,
            **{vol.Required(key): kind for key, kind in fields.items()},
            **(
                {vol.Optional("sync_now", default=True): bool}
                if command in {"users/create", "users/update"}
                else {}
            ),
            **(
                {vol.Optional("user_id"): str, vol.Optional("revision"): int}
                if command == "users/adopt"
                else {}
            ),
        }
    )

    @websocket_api.websocket_command(
        vol.All(vol.Schema({"type": f"{DOMAIN}/{command}"}, extra=vol.ALLOW_EXTRA))
    )
    @websocket_api.require_admin
    @websocket_api.async_response
    async def handle(
        hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
    ) -> None:
        try:
            # Validate here so HA's humanized schema errors cannot echo credential inputs.
            schema(msg)
            for key, kind in fields.items():
                if kind in {int, bool} and type(msg[key]) is not kind:
                    raise AccessError("invalid_fields")
            maximum = 1_048_576 if command in {"users/csv_preview", "users/csv_apply"} else 65_536
            if len(json.dumps(msg, ensure_ascii=False).encode()) > maximum:
                raise AccessError("request_too_large")
            limiter = hass.data[DOMAIN].setdefault("admin_limiter", AdminLimiter())
            admitted = limiter.acquire(connection.user.id, hass.loop.time())
            try:
                result = await _dispatch(hass, command, msg, actor=connection.user.id)
            finally:
                limiter.release(admitted)
        except vol.Invalid:
            connection.send_error(msg["id"], "invalid_fields", "Invalid command fields")
        except AccessError as err:
            connection.send_error(
                msg["id"],
                err.code,
                "Access action could not be completed",
                translation_domain=DOMAIN,
                translation_key="access_action_failed",
                translation_placeholders={"reason": err.code},
            )
        except HikvisionError:
            connection.send_error(
                msg["id"], "device_unavailable", "Station request did not complete"
            )
        except Exception:
            _LOGGER.error("Administrator command failed (%s); private payload omitted", command)
            connection.send_error(msg["id"], "action_failed", "Action could not be completed")
        else:
            connection.send_result(msg["id"], result)

    return handle


@websocket_api.websocket_command(
    vol.All(vol.Schema({"type": f"{DOMAIN}/subscribe"}, extra=vol.ALLOW_EXTRA))
)
@websocket_api.require_admin
@callback
def subscribe(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    if set(msg) - {"id", "type"}:
        connection.send_error(msg["id"], "invalid_fields", "Invalid command fields")
        return
    timer: asyncio.TimerHandle | None = None
    closed = False

    @callback
    def send() -> None:
        nonlocal timer
        timer = None
        if not closed and connection.user and connection.user.is_admin:
            # Data-free invalidation coalesces bursts and never leaks revoked-user data.
            connection.send_event(msg["id"], {"kind": "refresh"})

    @callback
    def changed() -> None:
        nonlocal timer
        if timer is None and not closed:
            timer = hass.loop.call_later(0.25, send)

    unsub = async_dispatcher_connect(hass, SIGNAL_ACCESS_CHANGED, changed)

    @callback
    def cancel() -> None:
        nonlocal closed
        closed = True
        unsub()
        if timer:
            timer.cancel()

    connection.subscriptions[msg["id"]] = cancel
    connection.send_result(msg["id"])


@callback
def async_register_websocket(hass: HomeAssistant) -> None:
    install_filter()
    for command, fields in COMMANDS.items():
        websocket_api.async_register_command(hass, _command_handler(command, fields))
    websocket_api.async_register_command(hass, subscribe)
