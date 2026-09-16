"""Persistent, revisioned fleet NTP preferences. Saving never changes a device."""

from __future__ import annotations

import asyncio
import ipaddress
import re
from collections.abc import Awaitable, Callable
from copy import deepcopy
from typing import Any

from .access.models import AccessError

DEFAULTS = {"server": "time.windows.com", "port": 123, "interval": 60}


def normalize(values: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(values, dict) or set(values) != set(DEFAULTS):
        raise AccessError("invalid_fields")
    host = values["server"]
    if not isinstance(host, str) or not 1 <= len(host) <= 64:
        raise AccessError("invalid_fields")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        if not all(
            re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label)
            for label in host.split(".")
        ):
            raise AccessError("invalid_fields") from None
        if re.fullmatch(r"[0-9.]+", host):
            raise AccessError("invalid_fields") from None
    else:
        if address.version != 4 or address.is_unspecified or address.is_multicast:
            raise AccessError("invalid_fields")
    if type(values["port"]) is not int or not 2 <= values["port"] <= 65535:
        raise AccessError("invalid_fields")
    if type(values["interval"]) is not int or not 1 <= values["interval"] <= 10080:
        raise AccessError("invalid_fields")
    return {**values, "server": host.lower()}


class NtpSettings:
    def __init__(
        self, save: Callable[[dict[str, Any]], Awaitable[None]], changed: Callable[[], None]
    ):
        self.save = save
        self.changed = changed
        self.data: dict[str, Any] = {"schema": 1, "revision": 0, "values": dict(DEFAULTS)}
        self.lock = asyncio.Lock()

    def load(self, data: dict[str, Any] | None) -> None:
        if data is None:
            return
        try:
            if (
                set(data) != {"schema", "revision", "values"}
                or type(data["schema"]) is not int
                or data["schema"] != 1
                or type(data["revision"]) is not int
                or data["revision"] < 0
            ):
                raise ValueError
            values = normalize(data["values"])
        except (ValueError, TypeError, KeyError, AccessError):
            raise AccessError("invalid_storage") from None
        self.data = {**data, "values": values}

    def public(self) -> dict[str, Any]:
        return {"revision": self.data["revision"], **deepcopy(self.data["values"])}

    async def update(self, revision: int, values: dict[str, Any]) -> dict[str, Any]:
        async with self.lock:
            values = normalize(values)
            if type(revision) is not int or revision != self.data["revision"]:
                raise AccessError("revision_conflict")
            if values != self.data["values"]:
                draft = {"schema": 1, "revision": revision + 1, "values": values}

                async def commit() -> None:
                    await self.save(draft)
                    self.data = draft
                    self.changed()

                task = asyncio.create_task(commit())
                try:
                    await asyncio.shield(task)
                except asyncio.CancelledError:
                    await task
                    raise
            return self.public()
