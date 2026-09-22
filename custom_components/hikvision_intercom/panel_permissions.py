"""Durable, fail-closed WisKey permissions for Home Assistant users."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Iterable
from copy import deepcopy
from typing import Any

from .access.models import AccessError

AREAS = ("overview", "users", "events", "stations", "management")
LEVELS = ("none", "view", "manage")
_LEVEL_VALUE = {"none": 0, "view": 1, "manage": 2}


def _empty() -> dict[str, str]:
    return {area: "none" for area in AREAS}


def normalize_policy(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {"enabled", "areas"}:
        raise AccessError("invalid_fields")
    if type(value["enabled"]) is not bool:
        raise AccessError("invalid_fields")
    areas = value["areas"]
    if not isinstance(areas, dict) or set(areas) != set(AREAS):
        raise AccessError("invalid_fields")
    if any(level not in LEVELS for level in areas.values()):
        raise AccessError("invalid_fields")
    return {"enabled": value["enabled"], "areas": dict(areas)}


class PanelPermissions:
    """Revisioned policies keyed only by immutable Home Assistant user IDs."""

    def __init__(
        self, save: Callable[[dict[str, Any]], Awaitable[None]], changed: Callable[[], None]
    ) -> None:
        self._save = save
        self._changed = changed
        self._lock = asyncio.Lock()
        self._data: dict[str, Any] = {"schema": 1, "revision": 0, "users": {}}
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
                or set(data) != {"schema", "revision", "users"}
                or data["schema"] != 1
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
                users[user_id] = normalize_policy(raw)
        except (AccessError, KeyError, TypeError, ValueError):
            raise AccessError("invalid_storage") from None
        self._data = {"schema": 1, "revision": data["revision"], "users": users}

    @property
    def revision(self) -> int:
        return self._data["revision"]

    def policy(self, user: Any) -> dict[str, Any]:
        if not user or not user.is_active:
            return {"allowed": False, "is_admin": False, "areas": _empty()}
        if user.is_admin:
            return {
                "allowed": True,
                "is_admin": True,
                "areas": {area: "manage" for area in AREAS},
            }
        stored = self._data["users"].get(user.id)
        if not stored or not stored["enabled"]:
            return {"allowed": False, "is_admin": False, "areas": _empty()}
        areas = dict(stored["areas"])
        return {
            "allowed": any(level != "none" for level in areas.values()),
            "is_admin": False,
            "areas": areas,
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
            "users": deepcopy(self._data["users"]),
        }

    async def update(
        self, revision: int, users: dict[str, Any], valid_user_ids: Iterable[str]
    ) -> dict[str, Any]:
        async with self._lock:
            if type(revision) is not int or revision != self._data["revision"]:
                raise AccessError("revision_conflict")
            if not isinstance(users, dict) or len(users) > 1000:
                raise AccessError("invalid_fields")
            valid = set(valid_user_ids)
            normalized: dict[str, Any] = {}
            for user_id, raw in users.items():
                if user_id not in valid:
                    raise AccessError("user_not_found")
                policy = normalize_policy(raw)
                if policy["enabled"] or any(level != "none" for level in policy["areas"].values()):
                    normalized[user_id] = policy
            if normalized != self._data["users"] or self._recovery:
                draft = {
                    "schema": 1,
                    "revision": revision + 1,
                    "users": normalized,
                }
                await self._save(draft)
                self._data = draft
                self._recovery = False
                self._changed()
            return self.public()


# Every panel command is classified here. Unknown commands fail closed.
# A tuple of requirements means any one grant is sufficient.
_READ_USERS = {
    "users/list",
    "users/query",
    "users/get",
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
    "users/create",
    "users/update",
    "users/delete",
    "users/set_active",
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
    "stations/list",
    "stations/get",
    "stations/inventory",
    "stations/technical_get",
    "stations/technical_codes_get",
    "stations/technical_program_list",
    "stations/technical_hold_get",
    "health/get",
    "acceptance/get",
    "media/call",
    "sync/status",
    "sync/diagnostics",
    "stations/permission_audit",
}
_WRITE_STATIONS = {
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

    if command in {"overview", "appearance/settings_get"}:
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
        required and any(permissions.permits(user, area, level) for area, level in required)
    )
