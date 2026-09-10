"""Local profile field definitions, groups and bounded user photo validation."""

from __future__ import annotations

import asyncio
import base64
import binascii
import re
from collections.abc import Awaitable, Callable
from copy import deepcopy
from typing import Any

from .access.models import AccessError

DEFAULTS: dict[str, Any] = {"fields": [], "groups": [], "photo_enabled": False}
ID = re.compile(r"[a-z][a-z0-9_]{0,47}")


def identifier(value: Any) -> str:
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise AccessError("invalid_fields")
    return value


def normalize(values: dict[str, Any]) -> dict[str, Any]:
    from .access.models import text_field

    if (
        not isinstance(values, dict)
        or set(values) != set(DEFAULTS)
        or type(values["photo_enabled"]) is not bool
    ):
        raise AccessError("invalid_fields")
    result: dict[str, Any] = {"photo_enabled": values["photo_enabled"]}
    for key, limit in (("fields", 12), ("groups", 64)):
        items = values[key]
        if not isinstance(items, list) or len(items) > limit:
            raise AccessError("invalid_fields")
        result[key] = []
        for item in items:
            expected = (
                {"id", "label", "enabled", "options"}
                if key == "fields"
                else {"id", "label", "enabled"}
            )
            if (
                not isinstance(item, dict)
                or not expected
                <= set(item)
                <= expected | ({"station_ids"} if key == "groups" else set())
                or type(item["enabled"]) is not bool
            ):
                raise AccessError("invalid_fields")
            normalized: dict[str, Any] = {
                "id": identifier(item["id"]),
                "label": text_field(item["label"], 64),
                "enabled": item["enabled"],
            }
            if key == "fields":
                options = item["options"]
                if not isinstance(options, list) or len(options) > 100:
                    raise AccessError("invalid_fields")
                normalized["options"] = [text_field(v, 100) for v in options]
                if len(set(normalized["options"])) != len(options):
                    raise AccessError("invalid_fields")
            if key == "groups" and "station_ids" in item:
                stations = item["station_ids"]
                if not isinstance(stations, list) or len(stations) > 100:
                    raise AccessError("invalid_fields")
                normalized["station_ids"] = sorted(text_field(s, 64) for s in stations)
                if len(set(normalized["station_ids"])) != len(stations):
                    raise AccessError("invalid_fields")
            result[key].append(normalized)
        if len({v["id"] for v in result[key]}) != len(items):
            raise AccessError("invalid_fields")
    return result


def profile_values(value: Any) -> dict[str, str]:
    from .access.models import text_field

    if not isinstance(value, dict) or len(value) > 12:
        raise AccessError("invalid_fields")
    return {identifier(k): text_field(v, 100, empty=True) for k, v in value.items()}


def group_values(value: Any) -> list[str]:
    if not isinstance(value, list) or len(value) > 64:
        raise AccessError("invalid_fields")
    result = [identifier(v) for v in value]
    if len(set(result)) != len(result):
        raise AccessError("invalid_fields")
    return sorted(result)


def photo_value(value: Any) -> str | None:
    """Accept only a small JPEG with bounded frame dimensions; never SVG or arbitrary URLs."""
    if value is None:
        return None
    if (
        not isinstance(value, str)
        or not value.startswith("data:image/jpeg;base64,")
        or len(value) > 44000
    ):
        raise AccessError("invalid_photo")
    try:
        data = base64.b64decode(value[23:], validate=True)
        if len(data) > 32768 or data[:2] != b"\xff\xd8" or data[-2:] != b"\xff\xd9":
            raise ValueError
        offset, dimensions = 2, False
        while offset + 4 <= len(data):
            if data[offset] != 255:
                raise ValueError
            marker = data[offset + 1]
            if marker == 218:
                break
            size = int.from_bytes(data[offset + 2 : offset + 4], "big")
            if size < 2 or offset + size + 2 > len(data):
                raise ValueError
            if marker in (192, 194):
                height = int.from_bytes(data[offset + 5 : offset + 7], "big")
                width = int.from_bytes(data[offset + 7 : offset + 9], "big")
                if size < 8 or not 1 <= width <= 512 or not 1 <= height <= 512:
                    raise ValueError
                dimensions = True
            offset += size + 2
        if not dimensions:
            raise ValueError
    except (ValueError, binascii.Error):
        raise AccessError("invalid_photo") from None
    return value


class ProfileSettings:
    def __init__(
        self,
        save: Callable[[dict[str, Any]], Awaitable[None]],
        changed: Callable[[], None],
        read: Callable[[], dict[str, Any] | None] | None = None,
    ):
        self.read = read
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
        if self.read and (data := self.read()) is not None:
            self.data = data
        return {"revision": self.data["revision"], **deepcopy(self.data["values"])}

    async def update(self, revision: int, values: dict[str, Any]) -> dict[str, Any]:
        async with self.lock:
            self.public()
            # Older clients do not send station_ids; preserve established group grants.
            values = deepcopy(values)
            if isinstance(values, dict) and isinstance(values.get("groups"), list):
                old = {g["id"]: g for g in self.data["values"]["groups"]}
                for group in values["groups"]:
                    if isinstance(group, dict) and isinstance(group.get("id"), str):
                        prior = old.get(group["id"], {})
                        if "station_ids" not in group and "station_ids" in prior:
                            group["station_ids"] = prior["station_ids"]
            values = normalize(values)
            if type(revision) is not int or revision != self.data["revision"]:
                raise AccessError("revision_conflict")
            # Definitions are archived rather than deleted, preserving IDs and existing data.
            for key in ("fields", "groups"):
                if {v["id"] for v in self.data["values"][key]} - {v["id"] for v in values[key]}:
                    raise AccessError("profile_definition_in_use")
            if values != self.data["values"]:
                draft = {"schema": 1, "revision": revision + 1, "values": values}
                await self.save(draft)
                self.data = draft
                self.changed()
            return self.public()
