"""Durable, fail-closed WisKey permissions for Home Assistant users."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Iterable
from copy import deepcopy
from typing import Any

from .access.models import AccessError

AREAS = ("overview", "users", "events", "stations", "management")
LEVELS = ("none", "view", "manage")
FIELDS = ("phone", "photo", "credentials", "profile", "access")
_LEVEL_VALUE = {"none": 0, "view": 1, "manage": 2}


def _empty() -> dict[str, str]:
    return {area: "none" for area in AREAS}


def normalize_station_groups(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or len(value) > 64:
        raise AccessError("invalid_fields")
    result = []
    for item in value:
        if not isinstance(item, dict) or set(item) != {"id", "label", "station_ids"}:
            raise AccessError("invalid_fields")
        for key in ("id", "label"):
            if (
                not isinstance(item[key], str)
                or not 1 <= len(item[key]) <= 64
                or any(ord(c) < 32 for c in item[key])
            ):
                raise AccessError("invalid_fields")
        # Reuse station ID validation; groups never imply access to future unknown stations.
        normalized = normalize_policy(
            {"enabled": True, "areas": _empty(), "station_ids": item["station_ids"]}
        )
        if normalized["station_ids"] is None:
            raise AccessError("invalid_fields")
        result.append(
            {"id": item["id"], "label": item["label"], "station_ids": normalized["station_ids"]}
        )
    if len({item["id"] for item in result}) != len(result):
        raise AccessError("invalid_fields")
    return result


def effective_stations(policy: dict[str, Any], groups: list[dict[str, Any]]) -> list[str] | None:
    if policy["station_ids"] is None:
        return None
    ids = set(policy.get("station_group_ids", []))
    known = {item["id"] for item in groups}
    if ids - known:
        raise AccessError("invalid_fields")
    return sorted(
        set(policy["station_ids"])
        | {sid for group in groups if group["id"] in ids for sid in group["station_ids"]}
    )


def normalize_policy(value: Any) -> dict[str, Any]:
    if (
        not isinstance(value, dict)
        or not {"enabled", "areas"} <= set(value)
        or set(value)
        - {"enabled", "areas", "station_ids", "fields", "profile_fields", "station_group_ids"}
    ):
        raise AccessError("invalid_fields")
    if type(value["enabled"]) is not bool:
        raise AccessError("invalid_fields")
    areas = value["areas"]
    if not isinstance(areas, dict) or set(areas) != set(AREAS):
        raise AccessError("invalid_fields")
    if any(not isinstance(level, str) or level not in LEVELS for level in areas.values()):
        raise AccessError("invalid_fields")
    stations = value.get("station_ids")
    if stations is not None and (
        not isinstance(stations, list)
        or len(stations) > 1000
        or any(
            not isinstance(sid, str) or not 1 <= len(sid) <= 128 or any(ord(c) < 32 for c in sid)
            for sid in stations
        )
        or len(set(stations)) != len(stations)
    ):
        raise AccessError("invalid_fields")
    fields = value.get("fields", {key: "manage" for key in FIELDS})
    if (
        not isinstance(fields, dict)
        or set(fields) != set(FIELDS)
        or any(not isinstance(level, str) or level not in LEVELS for level in fields.values())
    ):
        raise AccessError("invalid_fields")
    profile_fields = value.get("profile_fields", {})
    group_ids = value.get("station_group_ids", [])
    if (
        not isinstance(profile_fields, dict)
        or len(profile_fields) > 12
        or any(
            not isinstance(key, str)
            or not 1 <= len(key) <= 48
            or not isinstance(level, str)
            or level not in LEVELS
            for key, level in profile_fields.items()
        )
        or not isinstance(group_ids, list)
        or len(group_ids) > 64
        or any(not isinstance(key, str) or not 1 <= len(key) <= 64 for key in group_ids)
        or len(set(group_ids)) != len(group_ids)
    ):
        raise AccessError("invalid_fields")
    return {
        "enabled": value["enabled"],
        "areas": dict(areas),
        "station_ids": sorted(stations) if stations is not None else None,
        "fields": dict(fields),
        **({"profile_fields": dict(profile_fields)} if profile_fields else {}),
        **({"station_group_ids": sorted(group_ids)} if group_ids else {}),
    }


class PanelPermissions:
    """Revisioned policies keyed only by immutable Home Assistant user IDs."""

    def __init__(
        self, save: Callable[[dict[str, Any]], Awaitable[None]], changed: Callable[[], None]
    ) -> None:
        self._save = save
        self._changed = changed
        self._lock = asyncio.Lock()
        self._data: dict[str, Any] = {"schema": 3, "revision": 0, "users": {}, "station_groups": []}
        self._recovery = False

    def recover_from_invalid_storage(self) -> None:
        """Require the next explicit administrator save to replace invalid storage."""

        self._recovery = True

    def load(self, data: dict[str, Any] | None) -> None:
        if data is None:
            return
        try:
            if (
                not isinstance(data, dict)
                or set(data)
                != (
                    {"schema", "revision", "users", "station_groups"}
                    if data.get("schema") == 3
                    else {"schema", "revision", "users"}
                )
                or type(data["schema"]) is not int
                or data["schema"] not in {1, 2, 3}
                or type(data["revision"]) is not int
                or data["revision"] < 0
                or not isinstance(data["users"], dict)
                or len(data["users"]) > 1000
            ):
                raise ValueError
            users: dict[str, Any] = {}
            for user_id, raw in data["users"].items():
                if not isinstance(user_id, str) or not 1 <= len(user_id) <= 128:
                    raise ValueError
                if data["schema"] == 1 and (
                    not isinstance(raw, dict) or set(raw) != {"enabled", "areas"}
                ):
                    raise ValueError
                if data["schema"] == 2 and (
                    not isinstance(raw, dict)
                    or set(raw) != {"enabled", "areas", "station_ids", "fields"}
                ):
                    raise ValueError
                users[user_id] = normalize_policy(raw)
        except (AccessError, KeyError, TypeError, ValueError):
            raise AccessError("invalid_storage") from None
        try:
            groups = normalize_station_groups(data.get("station_groups", []))
        except AccessError:
            raise AccessError("invalid_storage") from None
        if any(
            set(item.get("station_group_ids", [])) - {g["id"] for g in groups}
            for item in users.values()
        ):
            raise AccessError("invalid_storage")
        self._data = {
            "schema": 3,
            "revision": data["revision"],
            "users": users,
            "station_groups": groups,
        }

    @property
    def revision(self) -> int:
        return int(self._data["revision"])

    def policy(self, user: Any) -> dict[str, Any]:
        if not user or not user.is_active:
            return self._denied()
        if user.is_admin:
            return {
                "allowed": True,
                "is_admin": True,
                "areas": {area: "manage" for area in AREAS},
                "station_ids": None,
                "fields": {key: "manage" for key in FIELDS},
            }
        stored = self._data["users"].get(user.id)
        if not stored or not stored["enabled"]:
            return self._denied()
        areas = dict(stored["areas"])
        return {
            "allowed": any(level != "none" for level in areas.values()),
            "is_admin": False,
            "areas": areas,
            "station_ids": effective_stations(stored, self._data["station_groups"]),
            "fields": dict(stored["fields"]),
            **(
                {"profile_fields": dict(stored["profile_fields"])}
                if stored.get("profile_fields")
                else {}
            ),
        }

    @staticmethod
    def _denied() -> dict[str, Any]:
        return {
            "allowed": False,
            "is_admin": False,
            "areas": _empty(),
            "station_ids": [],
            "fields": {key: "none" for key in FIELDS},
        }

    def permits(self, user: Any, area: str, level: str = "view") -> bool:
        policy = self.policy(user)
        return bool(
            policy["allowed"]
            and area in AREAS
            and level in _LEVEL_VALUE
            and _LEVEL_VALUE[policy["areas"][area]] >= _LEVEL_VALUE[level]
        )

    def public(self) -> dict[str, Any]:
        return {
            "revision": self._data["revision"],
            "areas": list(AREAS),
            "levels": list(LEVELS),
            "fields": list(FIELDS),
            "users": deepcopy(self._data["users"]),
            "station_groups": deepcopy(self._data["station_groups"]),
        }

    async def update(
        self,
        revision: int,
        users: dict[str, Any],
        valid_user_ids: Iterable[str],
        station_groups: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        async with self._lock:
            if type(revision) is not int or revision != self._data["revision"]:
                raise AccessError("revision_conflict")
            if not isinstance(users, dict) or len(users) > 1000:
                raise AccessError("invalid_fields")
            valid = set(valid_user_ids)
            groups = normalize_station_groups(
                self._data["station_groups"] if station_groups is None else station_groups
            )
            normalized: dict[str, Any] = {}
            for user_id, raw in users.items():
                if user_id not in valid:
                    raise AccessError("user_not_found")
                policy = normalize_policy(raw)
                if set(policy.get("station_group_ids", [])) - {g["id"] for g in groups}:
                    raise AccessError("invalid_fields")
                if policy["enabled"] or any(level != "none" for level in policy["areas"].values()):
                    normalized[user_id] = policy
            if (
                normalized != self._data["users"]
                or groups != self._data["station_groups"]
                or self._recovery
            ):
                draft = {
                    "schema": 3,
                    "revision": revision + 1,
                    "users": normalized,
                    "station_groups": groups,
                }
                # Do not let connection cancellation split durable and live authorization.
                task = asyncio.create_task(self._commit(draft))
                cancelled = False
                while not task.done():
                    try:
                        await asyncio.shield(task)
                    except asyncio.CancelledError:
                        cancelled = True
                task.result()
                if cancelled:
                    raise asyncio.CancelledError
            return self.public()

    async def _commit(self, draft: dict[str, Any]) -> None:
        await self._save(draft)
        self._data = draft
        self._recovery = False
        self._changed()


# Every panel command is classified here. Unknown commands fail closed.
# A tuple of requirements means any one grant is sufficient.
_READ_USERS = {
    "visits/operators",
    "visits/list",
    "guest_templates/get",
    "users/list",
    "users/query",
    "users/get",
    "users/lifecycle",
    "users/duplicate_check",
    "users/photo_get",
    "users/csv_export",
    "users/bulk_receipt",
    "users/bulk_receipts",
    "conflicts/list",
    "conflicts/review",
    "whatsapp/status",
    "whatsapp/history",
    "whatsapp/media",
}
_WRITE_USERS = {
    "workflows/renew_request",
    "visits/create",
    "visits/request",
    "visits/decide",
    "guest_templates/upsert",
    "guest_templates/delete",
    "users/create",
    "users/update",
    "users/delete",
    "users/set_active",
    "users/temporary_cancel",
    "users/pin_check",
    "users/pin_generate",
    "users/csv_inspect",
    "users/csv_preview",
    "users/csv_apply",
    "users/bulk_preview",
    "users/bulk_apply",
    "users/adopt",
    "users/delete_unmanaged",
    "users/ignore",
    "cards/reader_capabilities",
    "cards/capture_start",
    "cards/capture_status",
    "cards/capture_cancel",
    "cards/capture_confirm",
    "cards/add",
    "cards/remove",
    "sync/user",
    "sync/all",
    "conflicts/resolve",
    "conflicts/resolve_deletion",
    "whatsapp/preview",
    "whatsapp/send",
}
_READ_EVENTS = {
    "events/list",
    "events/detail",
    "events/support",
    "events/report",
    "events/export",
    "events/print",
}
_WRITE_EVENTS = {
    "events/history_inspect",
    "events/trace_start",
    "events/trace_get",
    "events/trace_stop",
}
_READ_STATIONS = {
    "fleet/alerts",
    "stations/list",
    "stations/get",
    "stations/inventory",
    "stations/technical_get",
    "stations/technical_codes_get",
    "stations/technical_program_list",
    "stations/technical_hold_get",
    "health/get",
    "health/history",
    "acceptance/get",
    "media/call",
    "sync/status",
    "sync/diagnostics",
    "stations/permission_audit",
}
_WRITE_STATIONS = {
    "fleet/alerts_action",
    "stations/rescan",
    "stations/technical_codes_write",
    "stations/technical_hold_delete",
    "stations/technical_program_save",
    "stations/technical_program_action",
    "stations/technical_hold_save",
    "stations/technical_relays",
    "stations/technical_update",
    "health/refresh",
    "acceptance/update",
    "sync/station",
}
_READ_MANAGEMENT = {
    "profiles/settings_get",
    "clock/settings_get",
    "clock/host_status",
    "media/settings_get",
    "media/provider_check",
    "permissions/directory",
    "operations/query",
    "audit/list",
    "audit/export",
    "whatsapp/templates_get",
    "schedules/operations_list",
    "schedules/operations_export",
    "schedules/plan_list",
    "schedules/plan_export",
    "schedules/list",
    "schedules/export",
    "schedules/readiness",
    "schedules/dependencies",
    "schedules/assess",
    "support/bundle",
    "fleet/inventory_export",
    "upgrade/readiness",
}
_WRITE_MANAGEMENT = {
    "profiles/settings_update",
    "profiles/settings_preview",
    "profiles/settings_apply",
    "clock/settings_update",
    "clock/host_apply",
    "clock/station_sync",
    "stations/clock_refresh",
    "media/settings_update",
    "media/provider_discover",
    "whatsapp/templates_update",
    "schedules/operations_claim_preview",
    "schedules/operations_claim_confirm",
    "schedules/operations_claim_release",
    "schedules/operations_create",
    "schedules/operations_check",
    "schedules/operations_cancel",
    "schedules/operations_archive",
    "schedules/plan_preview",
    "schedules/plan_save",
    "schedules/plan_recheck",
    "schedules/plan_delete",
    "schedules/import_preview",
    "schedules/import_apply",
    "schedules/create",
    "schedules/update",
    "schedules/delete",
    "schedules/preview",
    "schedules/baseline_save",
    "schedules/baseline_clear",
}


def requirements(command: str) -> tuple[tuple[str, str], ...] | None:
    """Return alternative area/level grants; None means administrator-only."""

    if command in {
        "overview",
        "overview/summary",
        "appearance/settings_get",
        "security/session",
        "security/touch",
        "security/lock",
        "security/reauth_start",
        "security/reauth_step",
    }:
        return tuple((area, "view") for area in AREAS)
    if command in {"stations/test_unlock", "media/signal", "tts/engines", "tts/start"}:
        return (("overview", "manage"), ("stations", "manage"))
    if command == "media/call":
        return (("overview", "view"), ("stations", "view"))
    if command in _READ_USERS:
        return (("users", "view"),)
    if command in _WRITE_USERS:
        return (("users", "manage"),)
    if command in _READ_EVENTS:
        return (("events", "view"),)
    if command in _WRITE_EVENTS:
        return (("events", "manage"),)
    if command in _READ_STATIONS:
        return (("stations", "view"),)
    if command in _WRITE_STATIONS:
        return (("stations", "manage"),)
    if command in _READ_MANAGEMENT:
        return (("management", "view"),)
    if command in _WRITE_MANAGEMENT:
        return (("management", "manage"),)
    return None


PREVIEW_ACTIONS = {
    "door_unlock": "stations/test_unlock",
    "station_view": "stations/get",
    "station_settings": "stations/technical_update",
    "station_maintenance": "fleet/alerts_action",
    "station_clock": "clock/station_sync",
    "tts_broadcast": "tts/start",
    "people_view": "users/get",
    "people_edit": "users/update",
    "card_capture": "cards/capture_start",
    "people_export": "users/csv_export",
    "whatsapp_send": "whatsapp/send",
    "events_view": "events/list",
    "events_export": "events/export",
    "event_capture": "events/trace_start",
    "system_settings": "media/settings_update",
}

# Restricted grants have an explicit supported command surface. Global libraries,
# CSV imports, approval jobs and opaque review tokens can affect other stations or
# contain hidden fields; those remain available to unrestricted grants and admins.
SCOPED_STATION_COMMANDS = frozenset(
    {
        "fleet/alerts_action",
        "stations/get",
        "stations/test_unlock",
        "stations/rescan",
        "stations/inventory",
        "stations/technical_get",
        "stations/technical_update",
        "stations/technical_relays",
        "stations/technical_codes_get",
        "stations/technical_codes_write",
        "stations/technical_hold_get",
        "stations/technical_hold_save",
        "stations/technical_hold_delete",
        "stations/technical_program_list",
        "stations/technical_program_save",
        "stations/technical_program_action",
        "stations/clock_refresh",
        "clock/station_sync",
        "health/get",
        "health/history",
        "health/refresh",
        "acceptance/get",
        "acceptance/update",
        "media/call",
        "media/signal",
        "sync/station",
        "events/history_inspect",
        "events/trace_start",
        "events/trace_get",
        "events/trace_stop",
        "schedules/readiness",
        "schedules/dependencies",
        "schedules/assess",
        "schedules/baseline_save",
        "schedules/baseline_clear",
        "cards/reader_capabilities",
    }
)
SCOPED_COMMON_COMMANDS = frozenset(
    {
        "workflows/renew_request",
        "fleet/alerts",
        "clock/settings_get",
        "overview",
        "overview/summary",
        "sync/status",
        "appearance/settings_get",
        "stations/list",
        "users/list",
        "users/query",
        "users/get",
        "users/photo_get",
        "users/update",
        "users/create",
        "users/set_active",
        "users/temporary_cancel",
        "users/delete",
        "users/pin_check",
        "users/pin_generate",
        "cards/add",
        "cards/remove",
        "cards/capture_start",
        "cards/capture_status",
        "cards/capture_cancel",
        "cards/capture_confirm",
        "sync/user",
        "profiles/settings_get",
        "events/list",
        "events/detail",
        "events/support",
        "events/report",
        "events/print",
        "events/export",
        "tts/engines",
        "tts/start",
    }
)
FIELD_SCOPED_STATION_COMMANDS = SCOPED_STATION_COMMANDS - {
    "stations/inventory",
    "events/history_inspect",
    "events/trace_start",
    "events/trace_get",
    "events/trace_stop",
    "schedules/dependencies",
    "schedules/assess",
}
FIELD_COMMANDS = {
    "users/create": ("access", "manage"),
    "users/photo_get": ("photo", "view"),
    "users/pin_check": ("credentials", "manage"),
    "users/pin_generate": ("credentials", "manage"),
    "cards/add": ("credentials", "manage"),
    "cards/remove": ("credentials", "manage"),
    "cards/reader_capabilities": ("credentials", "manage"),
    "cards/capture_start": ("credentials", "manage"),
    "cards/capture_status": ("credentials", "manage"),
    "cards/capture_cancel": ("credentials", "manage"),
    "cards/capture_confirm": ("credentials", "manage"),
    "users/set_active": ("access", "manage"),
    "users/temporary_cancel": ("access", "manage"),
}


def station_allowed(permissions: PanelPermissions | None, user: Any, station_id: str) -> bool:
    """Station scope intersects area grants; it never grants an area by itself."""
    if not user or not user.is_active:
        return False
    if user.is_admin:
        return True
    if not isinstance(permissions, PanelPermissions):
        return False
    policy = permissions.policy(user)
    return bool(
        policy["allowed"] and (policy["station_ids"] is None or station_id in policy["station_ids"])
    )


def field_allowed(policy: dict[str, Any], field: str, level: str = "view") -> bool:
    return bool(
        field in FIELDS
        and level in _LEVEL_VALUE
        and _LEVEL_VALUE[policy.get("fields", {}).get(field, "manage")] >= _LEVEL_VALUE[level]
    )


def profile_field_allowed(policy: dict[str, Any], identity: str, level: str = "view") -> bool:
    return bool(
        field_allowed(policy, "profile", level)
        and level in _LEVEL_VALUE
        and _LEVEL_VALUE[policy.get("profile_fields", {}).get(identity, "manage")]
        >= _LEVEL_VALUE[level]
    )


def policy_command_allowed(policy: dict[str, Any], command: str) -> bool:
    if command.startswith("security/"):
        return True
    station_restricted = policy.get("station_ids") is not None
    fields_restricted = any(not field_allowed(policy, field, "manage") for field in FIELDS) or any(
        level != "manage" for level in policy.get("profile_fields", {}).values()
    )
    if station_restricted and command not in SCOPED_COMMON_COMMANDS | SCOPED_STATION_COMMANDS:
        return False
    if fields_restricted and command not in SCOPED_COMMON_COMMANDS | FIELD_SCOPED_STATION_COMMANDS:
        return False
    if station_restricted and not policy["station_ids"]:
        return command in {"overview", "sync/status", "appearance/settings_get", "stations/list"}
    if command in FIELD_COMMANDS:
        field, level = FIELD_COMMANDS[command]
        return field_allowed(policy, field, level)
    if command in {"users/delete"} and fields_restricted:
        return False
    if command in {"events/detail", "events/support"} and fields_restricted:
        return False
    return True


def preview_policy(
    value: Any, station_groups: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    """Explain a proposed grant using the same command classification as enforcement."""

    policy = normalize_policy(value)
    policy["station_ids"] = effective_stations(
        policy, normalize_station_groups(station_groups or [])
    )

    def grants(command: str) -> bool:
        required = requirements(command)
        return bool(
            policy["enabled"]
            and policy_command_allowed(policy, command)
            and required
            and any(
                _LEVEL_VALUE[policy["areas"][area]] >= _LEVEL_VALUE[level]
                for area, level in required
            )
        )

    return {
        "enabled": policy["enabled"],
        "actions": {name: grants(command) for name, command in PREVIEW_ACTIONS.items()},
        "station_ids": policy["station_ids"],
        "fields": policy["fields"],
        "restricted": policy["station_ids"] is not None
        or any(level != "manage" for level in policy["fields"].values())
        or any(level != "manage" for level in policy.get("profile_fields", {}).values()),
    }


def area_allowed(
    permissions: PanelPermissions | None, user: Any, area: str, level: str = "view"
) -> bool:
    """Check an authenticated user against one area, with administrators always allowed."""

    if not user or not user.is_active:
        return False
    if user.is_admin:
        return True
    return isinstance(permissions, PanelPermissions) and permissions.permits(user, area, level)


def command_allowed(permissions: PanelPermissions | None, user: Any, command: str) -> bool:
    if not user or not user.is_active:
        return False
    if user.is_admin:
        return True
    if permissions is None:
        return False
    required = requirements(command)
    return bool(
        required
        and policy_command_allowed(permissions.policy(user), command)
        and any(permissions.permits(user, area, level) for area, level in required)
    )
