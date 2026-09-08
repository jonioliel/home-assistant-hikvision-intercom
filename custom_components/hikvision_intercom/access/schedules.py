"""Central schedule drafts. No device allocation, assignment, or write is performed."""

from __future__ import annotations

import asyncio
import re
from collections.abc import Callable
from copy import deepcopy
from datetime import date, datetime
from typing import Any
from uuid import uuid4

from .models import AccessError, text_field, utc_now, uuid_text
from .repository import Save

DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
MAX_SCHEDULES = 100
MAX_HOLIDAYS = 64


def minute(value: Any, *, end: bool = False) -> int:
    if not isinstance(value, str) or not re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", value):
        if end and value == "24:00":
            return 1440
        raise AccessError("schedule_invalid_time")
    hour, minutes = value.split(":")
    return int(hour) * 60 + int(minutes)


def periods(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list) or len(value) > 8:
        raise AccessError("schedule_period_limit")
    result = []
    for item in value:
        if not isinstance(item, dict) or set(item) != {"start", "end"}:
            raise AccessError("schedule_invalid_time")
        start, end = minute(item["start"]), minute(item["end"], end=True)
        if start >= end:
            raise AccessError("schedule_invalid_time")
        result.append({"start": item["start"], "end": item["end"]})
    result.sort(key=lambda item: item["start"])
    if any(
        minute(a["end"], end=True) > minute(b["start"])
        for a, b in zip(result, result[1:], strict=False)
    ):
        raise AccessError("schedule_overlap")
    return result


def calendar_date(value: Any) -> date:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise AccessError("schedule_invalid_date")
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise AccessError("schedule_invalid_date") from None
    if not 2000 <= parsed.year <= 2037:
        raise AccessError("schedule_invalid_date")
    return parsed


def normalize(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict) or set(data) != {"name", "weekly", "holidays"}:
        raise AccessError("invalid_fields")
    name = text_field(data["name"], 32)
    weekly = data["weekly"]
    if not isinstance(weekly, dict) or set(weekly) != set(DAYS):
        raise AccessError("schedule_invalid_week")
    week = {day: periods(weekly[day]) for day in DAYS}
    holidays = data["holidays"]
    if not isinstance(holidays, list) or len(holidays) > MAX_HOLIDAYS:
        raise AccessError("schedule_holiday_limit")
    result: list[dict[str, Any]] = []
    for holiday in holidays:
        if not isinstance(holiday, dict) or set(holiday) != {"name", "start", "end", "periods"}:
            raise AccessError("invalid_fields")
        start, end = calendar_date(holiday["start"]), calendar_date(holiday["end"])
        if start > end:
            raise AccessError("schedule_invalid_date")
        result.append(
            {
                "name": text_field(holiday["name"], 32),
                "start": start.isoformat(),
                "end": end.isoformat(),
                "periods": periods(holiday["periods"]),
            }
        )
    result.sort(key=lambda item: item["start"])
    if any(a["end"] >= b["start"] for a, b in zip(result, result[1:], strict=False)):
        raise AccessError("schedule_holiday_overlap")
    return {"name": name, "weekly": week, "holidays": result}


def preview(data: Any, on_date: str, at_time: str) -> dict[str, Any]:
    """Evaluate the local draft only; minute windows are [start, end), dates inclusive."""
    draft = normalize(data)
    day, at = calendar_date(on_date), minute(at_time)
    matching = next((h for h in draft["holidays"] if h["start"] <= on_date <= h["end"]), None)
    windows = matching["periods"] if matching else draft["weekly"][DAYS[day.weekday()]]
    return {
        "date": on_date,
        "time": at_time,
        "weekday": DAYS[day.weekday()],
        "source": "holiday" if matching else "weekly",
        "holiday": matching["name"] if matching else None,
        "periods": windows,
        "within_window": any(
            minute(w["start"]) <= at < minute(w["end"], end=True) for w in windows
        ),
        "basis": "draft_local_time",
        "applied": False,
    }


class ScheduleLibrary:
    """Independent strict storage with compare-and-swap and save-before-publish semantics."""

    def __init__(self, save: Save, changed: Callable[[], None] | None = None) -> None:
        self._save, self._changed = save, changed or (lambda: None)
        self._state: dict[str, Any] = {"schema": 1, "schedules": {}}
        self._lock = asyncio.Lock()

    async def async_load(self, data: Any) -> None:
        async with self._lock:
            if data is None:
                await self._save(deepcopy(self._state))
                return
            try:
                if (
                    not isinstance(data, dict)
                    or set(data) != {"schema", "schedules"}
                    or type(data["schema"]) is not int
                    or data["schema"] != 1
                ):
                    raise AccessError("invalid_storage")
                items = data["schedules"]
                if not isinstance(items, dict) or len(items) > MAX_SCHEDULES:
                    raise AccessError("invalid_storage")
                for key, item in items.items():
                    uuid_text(key)
                    if (
                        not isinstance(item, dict)
                        or set(item)
                        != {"id", "revision", "updated_at", "name", "weekly", "holidays"}
                        or key != item["id"]
                    ):
                        raise AccessError("invalid_storage")
                    if type(item["revision"]) is not int or item["revision"] < 1:
                        raise AccessError("invalid_storage")
                    if (
                        not isinstance(item["updated_at"], str)
                        or datetime.fromisoformat(item["updated_at"]).tzinfo is None
                    ):
                        raise AccessError("invalid_storage")
                    normalize({k: item[k] for k in ("name", "weekly", "holidays")})
            except (AccessError, KeyError, TypeError, ValueError, AttributeError):
                raise AccessError("invalid_storage") from None
            self._state = deepcopy(data)

    def list(self) -> list[dict[str, Any]]:
        return sorted(
            deepcopy(list(self._state["schedules"].values())),
            key=lambda item: (item["name"].casefold(), item["id"]),
        )

    async def _persist(self, state: dict[str, Any]) -> None:
        async def commit() -> None:
            await self._save(deepcopy(state))
            self._state = state
            self._changed()

        task = asyncio.create_task(commit())
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            await task
            raise

    async def async_save(
        self, data: Any, *, schedule_id: str | None = None, revision: int | None = None
    ) -> dict[str, Any]:
        draft = normalize(data)
        async with self._lock:
            items = self._state["schedules"]
            if schedule_id is not None:
                self._require(schedule_id, revision)
            elif len(items) >= MAX_SCHEDULES:
                raise AccessError("schedule_limit")
            key = schedule_id or str(uuid4())
            item = {
                **draft,
                "id": key,
                "revision": items[key]["revision"] + 1 if schedule_id else 1,
                "updated_at": utc_now(),
            }
            state = deepcopy(self._state)
            state["schedules"][key] = item
            await self._persist(state)
            return deepcopy(item)

    def _require(self, schedule_id: str, revision: int | None) -> None:
        uuid_text(schedule_id)
        item = self._state["schedules"].get(schedule_id)
        if item is None:
            raise AccessError("schedule_not_found")
        if type(revision) is not int or revision != item["revision"]:
            raise AccessError("revision_conflict")

    async def async_delete(self, schedule_id: str, revision: int) -> None:
        async with self._lock:
            self._require(schedule_id, revision)
            state = deepcopy(self._state)
            del state["schedules"][schedule_id]
            await self._persist(state)
