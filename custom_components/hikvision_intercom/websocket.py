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
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .access.models import AccessError
from .access_runtime import SIGNAL_ACCESS_CHANGED, get_manager
from .const import DOMAIN, VERSION
from .event_manager import get_events
from .exceptions import HikvisionError, HikvisionValidationError
from .hardening import AdminLimiter
from .log_filter import install_filter

_LOGGER = logging.getLogger(__name__)
USER_FIELDS = {
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
    "overview": {},
    "events/list": {"filters": dict},
    "users/list": {},
    "users/get": {"user_id": str},
    "users/create": {"data": dict},
    "users/update": {"user_id": str, "revision": int, "data": dict},
    "users/delete": {"user_id": str, "revision": int},
    "users/set_active": {"user_id": str, "revision": int, "active": bool},
    "cards/add": {"user_id": str, "revision": int, "data": dict},
    "cards/remove": {"user_id": str, "revision": int, "card_id": str},
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
        station.update(
            online=bool(
                runtime
                and not runtime.session.is_closed
                and runtime.coordinator.last_update_success
            ),
            call_state=runtime.coordinator.data.normalized
            if runtime and not runtime.session.is_closed and runtime.coordinator.last_update_success
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
    data["version"] = VERSION
    return data


async def _dispatch(hass: HomeAssistant, command: str, msg: dict[str, Any]) -> Any:
    manager = get_manager(hass)
    if command == "sync/diagnostics":
        return {"integration_version": VERSION, **manager.sync_diagnostics()}
    if command == "events/list":
        try:
            return get_events(hass).query(msg["filters"])
        except HikvisionValidationError:
            raise AccessError("invalid_fields") from None
    if command in {"overview", "sync/status"}:
        return overview(hass)
    if command == "users/list":
        return manager.repository.public()["users"]
    if command == "users/get":
        return manager.repository.get(msg["user_id"]).public()
    if command == "users/create":
        return await manager.async_create(_patch(msg["data"]))
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
        return await manager.async_update(msg["user_id"], _patch(patch), revision=msg["revision"])
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
        await runtime.async_unlock(msg["lock"])
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
    elif command in {"stations/rescan", "sync/station"}:
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
            if len(json.dumps(msg, ensure_ascii=False).encode()) > 65_536:
                raise AccessError("request_too_large")
            limiter = hass.data[DOMAIN].setdefault("admin_limiter", AdminLimiter())
            admitted = limiter.acquire(connection.user.id, hass.loop.time())
            try:
                result = await _dispatch(hass, command, msg)
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
