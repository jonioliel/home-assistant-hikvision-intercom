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


class AppearanceSettings:
    def __init__(
        self, save: Callable[[dict[str, Any]], Awaitable[None]], changed: Callable[[], None]
    ) -> None:
        self._save = save
        self._changed = changed
        self._lock = asyncio.Lock()
        self._data: dict[str, Any] = {"schema": 1, "revision": 0, "default": "current"}

    def load(self, data: Any) -> None:
        if data is None:
            return
        if (
            not isinstance(data, dict)
            or set(data) != {"schema", "revision", "default"}
            or type(data["schema"]) is not int
            or data["schema"] != 1
            or type(data["revision"]) is not int
            or data["revision"] < 0
            or data["default"] not in APPEARANCES
        ):
            raise AccessError("invalid_storage")
        self._data = dict(data)

    def public(self) -> dict[str, Any]:
        return {"revision": self._data["revision"], "default": self._data["default"]}

    async def update(self, revision: int, appearance: str) -> dict[str, Any]:
        async with self._lock:
            if type(revision) is not int or revision != self._data["revision"]:
                raise AccessError("revision_conflict")
            if appearance not in APPEARANCES:
                raise AccessError("invalid_fields")
            if appearance != self._data["default"]:
                draft = {"schema": 1, "revision": revision + 1, "default": appearance}
                await self._save(draft)
                self._data = draft
                self._changed()
            return self.public()
