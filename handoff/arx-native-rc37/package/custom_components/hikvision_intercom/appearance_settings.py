"""Versioned shared panel appearance; no device or access policy side effects."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from .access.models import AccessError

APPEARANCES = (
    "current",
    "modern",
    "access-light",
    "access-dark",
    "wiskey-light",
    "wiskey-dark",
)
ACCENTS = ("green", "blue", "purple", "teal", "orange", "rose")


class AppearanceSettings:
    def __init__(
        self, save: Callable[[dict[str, Any]], Awaitable[None]], changed: Callable[[], None]
    ) -> None:
        self._save = save
        self._changed = changed
        self._lock = asyncio.Lock()
        self._data: dict[str, Any] = {
            "schema": 2,
            "revision": 0,
            "default": "current",
            "accent": "green",
        }

    def load(self, data: Any) -> None:
        if data is None:
            return
        if (
            not isinstance(data, dict)
            or set(data)
            != (
                {"schema", "revision", "default"}
                if data.get("schema") == 1
                else {"schema", "revision", "default", "accent"}
            )
            or type(data["schema"]) is not int
            or data["schema"] not in {1, 2}
            or type(data["revision"]) is not int
            or data["revision"] < 0
            or data["default"] not in APPEARANCES
            or (data["schema"] == 2 and data["accent"] not in ACCENTS)
        ):
            raise AccessError("invalid_storage")
        self._data = {**data, "schema": 2, "accent": data.get("accent", "green")}

    def public(self) -> dict[str, Any]:
        return {key: self._data[key] for key in ("revision", "default", "accent")}

    async def update(
        self, revision: int, appearance: str, accent: str | None = None
    ) -> dict[str, Any]:
        async with self._lock:
            if type(revision) is not int or revision != self._data["revision"]:
                raise AccessError("revision_conflict")
            color = self._data["accent"] if accent is None else accent
            if appearance not in APPEARANCES or color not in ACCENTS:
                raise AccessError("invalid_fields")
            if appearance != self._data["default"] or color != self._data["accent"]:
                draft = {
                    "schema": 2,
                    "revision": revision + 1,
                    "default": appearance,
                    "accent": color,
                }
                await self._save(draft)
                self._data = draft
                self._changed()
            return self.public()
