"""Revisioned visit presets. Templates contain no credentials and grant no access."""

from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from .models import AccessError
from .user_timing import timing_draft

FIELDS = {
    "label",
    "access_category",
    "responsible_person",
    "access_purpose",
    "duration_minutes",
    "doors",
    "weekly_timing",
}
MAX_TEMPLATES = 100


def text(value: Any, maximum: int, *, required: bool = False) -> str:
    if not isinstance(value, str) or len(value) > maximum or any(ord(c) < 32 for c in value):
        raise AccessError("invalid_fields")
    cleaned: str = value.strip()
    if required and not cleaned:
        raise AccessError("invalid_fields")
    return cleaned


def normalize(values: Any) -> dict[str, Any]:
    if not isinstance(values, dict) or set(values) != FIELDS:
        raise AccessError("invalid_fields")
    category = values["access_category"]
    if not isinstance(category, str) or category not in {"visitor", "contractor"}:
        raise AccessError("invalid_fields")
    duration = values["duration_minutes"]
    if type(duration) is not int or not 15 <= duration <= 43200:
        raise AccessError("invalid_fields")
    doors = values["doors"]
    if not isinstance(doors, dict) or not 1 <= len(doors) <= 100:
        raise AccessError("invalid_fields")
    normalized_doors = {}
    for station_id, locks in doors.items():
        if (
            not isinstance(station_id, str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", station_id)
            or not isinstance(locks, list)
            or not 1 <= len(locks) <= 2
            or any(type(lock) is not int or lock not in {1, 2} for lock in locks)
            or len(set(locks)) != len(locks)
        ):
            raise AccessError("invalid_fields")
        normalized_doors[station_id] = sorted(locks)
    weekly = timing_draft(values["weekly_timing"])
    if weekly is not None and weekly["mode"] != "weekly":
        raise AccessError("invalid_user_timing")
    return {
        "label": text(values["label"], 80, required=True),
        "access_category": category,
        "responsible_person": text(values["responsible_person"], 64, required=True),
        "access_purpose": text(values["access_purpose"], 128),
        "duration_minutes": duration,
        "doors": normalized_doors,
        "weekly_timing": weekly,
    }


class GuestTemplates:
    def __init__(
        self, save: Callable[[dict[str, Any]], Awaitable[None]], changed: Callable[[], None]
    ) -> None:
        self._save = save
        self._changed = changed
        self._lock = asyncio.Lock()
        self._data: dict[str, Any] = {"schema": 1, "revision": 0, "items": []}

    def load(self, data: Any) -> None:
        if data is None:
            return
        try:
            if (
                not isinstance(data, dict)
                or set(data) != {"schema", "revision", "items"}
                or type(data["schema"]) is not int
                or data["schema"] != 1
                or type(data["revision"]) is not int
                or data["revision"] < 0
                or not isinstance(data["items"], list)
                or len(data["items"]) > MAX_TEMPLATES
            ):
                raise ValueError
            seen = set()
            items = []
            for item in data["items"]:
                if not isinstance(item, dict) or set(item) != FIELDS | {
                    "id",
                    "updated_at",
                    "updated_by",
                }:
                    raise ValueError
                identity = item["id"]
                if (
                    not isinstance(identity, str)
                    or not re.fullmatch(r"[a-f0-9]{32}", identity)
                    or identity in seen
                    or not isinstance(item["updated_at"], str)
                    or len(item["updated_at"]) > 40
                    or datetime.fromisoformat(item["updated_at"]).tzinfo is None
                ):
                    raise ValueError
                seen.add(identity)
                items.append(
                    {
                        **normalize({key: item[key] for key in FIELDS}),
                        "id": identity,
                        "updated_at": item["updated_at"],
                        "updated_by": text(item["updated_by"], 64),
                    }
                )
        except (ValueError, TypeError, KeyError, AccessError, OverflowError):
            raise AccessError("invalid_storage") from None
        self._data = {"schema": 1, "revision": data["revision"], "items": items}

    def public(self) -> dict[str, Any]:
        return {"revision": self._data["revision"], "items": deepcopy(self._data["items"])}

    async def _commit(self, draft: dict[str, Any]) -> None:
        async def persist() -> None:
            await self._save(deepcopy(draft))
            self._data = draft
            self._changed()

        task = asyncio.create_task(persist())
        cancelled = False
        while not task.done():
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                cancelled = True
        task.result()
        if cancelled:
            raise asyncio.CancelledError

    async def upsert(
        self, revision: int, template_id: str, values: dict[str, Any], actor: str
    ) -> dict[str, Any]:
        normalized = normalize(values)
        actor = text(actor, 64)
        if not isinstance(template_id, str):
            raise AccessError("invalid_fields")
        async with self._lock:
            if type(revision) is not int or revision != self._data["revision"]:
                raise AccessError("revision_conflict")
            current = next(
                (item for item in self._data["items"] if item["id"] == template_id), None
            )
            if template_id and current is None:
                raise AccessError("guest_template_not_found")
            if current is None and len(self._data["items"]) >= MAX_TEMPLATES:
                raise AccessError("guest_template_limit")
            if current is not None and all(current[key] == normalized[key] for key in FIELDS):
                return self.public()
            identity = template_id or uuid4().hex
            draft = deepcopy(self._data)
            draft["revision"] += 1
            item = {
                **normalized,
                "id": identity,
                "updated_at": datetime.now(UTC).isoformat(),
                "updated_by": actor,
            }
            draft["items"] = [row for row in draft["items"] if row["id"] != identity] + [item]
            await self._commit(draft)
            return self.public()

    async def delete(self, revision: int, template_id: str) -> dict[str, Any]:
        if not isinstance(template_id, str):
            raise AccessError("invalid_fields")
        async with self._lock:
            if type(revision) is not int or revision != self._data["revision"]:
                raise AccessError("revision_conflict")
            if not any(item["id"] == template_id for item in self._data["items"]):
                raise AccessError("guest_template_not_found")
            draft = deepcopy(self._data)
            draft["revision"] += 1
            draft["items"] = [row for row in draft["items"] if row["id"] != template_id]
            await self._commit(draft)
            return self.public()
