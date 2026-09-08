"""Strict private HA Store: failed persistence must prevent subsequent device writes.

HA 2026.9 Store.async_save logs some write failures and defers saves while stopping.
This adapter uses the same envelope/path and HA atomic file helper, but propagates
errors and never treats a corrupt existing database as a new empty installation.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from homeassistant.core import CoreState, HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.util.file import write_utf8_file_atomic

from .access.models import AccessError


class AccessStore(Store[dict[str, Any]]):
    def __init__(self, hass: HomeAssistant, *, key: str = "hikvision_intercom.users") -> None:
        super().__init__(hass, 1, key, private=True, atomic_writes=True)

    async def async_load(self) -> dict[str, Any] | None:
        return await self.hass.async_add_executor_job(self._load_strict)

    def _load_strict(self) -> dict[str, Any] | None:
        path = Path(self.path)
        try:
            with path.open(encoding="utf-8") as source:
                envelope = json.load(source)
            if (
                not isinstance(envelope, dict)
                or envelope.get("key") != self.key
                or envelope.get("version") != self.version
                or envelope.get("minor_version", 1) != self.minor_version
                or not isinstance(envelope.get("data"), dict)
            ):
                raise AccessError("invalid_storage")
            return envelope["data"]
        except FileNotFoundError:
            if any(path.parent.glob(path.name + ".corrupt.*")):
                raise AccessError("invalid_storage") from None
            return None
        except (OSError, ValueError, TypeError):
            raise AccessError("invalid_storage") from None

    async def async_save(self, data: dict[str, Any]) -> None:
        if self.hass.state in {CoreState.stopping, CoreState.final_write, CoreState.stopped}:
            raise AccessError("storage_stopping")
        await self.hass.async_add_executor_job(self._save_strict, data)

    def _save_strict(self, data: dict[str, Any]) -> None:
        try:
            encoded = json.dumps(
                {
                    "version": self.version,
                    "minor_version": self.minor_version,
                    "key": self.key,
                    "data": data,
                },
                ensure_ascii=False,
                allow_nan=False,
            )
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
            write_utf8_file_atomic(self.path, encoded, private=True)
        except Exception:
            raise AccessError("storage_write_failed") from None
