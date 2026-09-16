"""Durable, administrator-defined WhatsApp access-message templates."""

from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable, Mapping
from copy import deepcopy
from typing import Any

from .access.models import AccessError

DEFAULTS = {
    "organization": "מתנ״ס אפרת",
    "he_unrestricted": """שלום {{name}}, 🥇

🏫 {{organization}}
העניק לך הרשאת גישה ב־WisKey 🔐

קוד הגישה האישי שלך:
📟 {{pin}} 📟

{{doors_section}}🚫 ⚠️ ידוע לך כי חל איסור מוחלט למסור את הקוד לאחרים. ⚠️ 🚫""",
    "he_scheduled": """שלום {{name}}, 🥇

🏫 {{organization}}
העניק לך הרשאת גישה ב־WisKey 🔐

קוד הגישה האישי שלך:
📟 {{pin}} 📟

{{doors_section}}{{access_window_section}}"""
    "🚫 ⚠️ ידוע לך כי חל איסור מוחלט למסור את הקוד לאחרים. ⚠️ 🚫",
    "en_unrestricted": """Hello {{name}}, 🥇

🏫 {{organization}}
has granted you WisKey access 🔐

Your personal access code:
📟 {{pin}} 📟

{{doors_section}}🚫 ⚠️ Never share this code with anyone. ⚠️ 🚫""",
    "en_scheduled": """Hello {{name}}, 🥇

🏫 {{organization}}
has granted you WisKey access 🔐

Your personal access code:
📟 {{pin}} 📟

{{doors_section}}{{access_window_section}}🚫 ⚠️ Never share this code with anyone. ⚠️ 🚫""",
}

PLACEHOLDERS = frozenset(
    {
        "name",
        "organization",
        "pin",
        "status",
        "doors",
        "doors_section",
        "days",
        "dates",
        "hours",
        "validity",
        "timezone",
        "access_window_section",
    }
)
_TOKEN = re.compile(r"{{\s*([a-z_]+)\s*}}")


def normalize(values: dict[str, Any]) -> dict[str, str]:
    if not isinstance(values, dict) or set(values) != set(DEFAULTS):
        raise AccessError("invalid_fields")
    result: dict[str, str] = {}
    for key, raw in values.items():
        maximum = 120 if key == "organization" else 12_000
        if not isinstance(raw, str) or not raw.strip() or len(raw) > maximum:
            raise AccessError("invalid_fields")
        if any(ord(char) < 32 and char not in "\n\t" for char in raw):
            raise AccessError("invalid_fields")
        if key != "organization":
            found = set(_TOKEN.findall(raw))
            remainder = _TOKEN.sub("", raw)
            if found - PLACEHOLDERS or "name" not in found or "pin" not in found:
                raise AccessError("invalid_fields")
            if key.endswith("scheduled") and "access_window_section" not in found:
                raise AccessError("invalid_fields")
            if "{{" in remainder or "}}" in remainder:
                raise AccessError("invalid_fields")
        result[key] = raw.strip()
    return result


def render_template(template: str, variables: Mapping[str, str]) -> str:
    """Replace documented literal placeholders; never evaluate template code."""

    message = _TOKEN.sub(lambda match: variables.get(match.group(1), ""), template)
    message = re.sub(r"[ \t]+\n", "\n", message)
    message = re.sub(r"\n{3,}", "\n\n", message).strip()
    if not message or len(message) > 12_000:
        raise AccessError("invalid_fields")
    return message


class WhatsAppTemplates:
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
                or data["schema"] != 1
                or type(data["revision"]) is not int
                or data["revision"] < 0
            ):
                raise ValueError
            values = normalize(data["values"])
        except (ValueError, TypeError, KeyError, AccessError):
            raise AccessError("invalid_storage") from None
        self.data = {**data, "values": values}

    def public(self, *, defaults: bool = False) -> dict[str, Any]:
        result = {"revision": self.data["revision"], **deepcopy(self.data["values"])}
        if defaults:
            result["defaults"] = deepcopy(DEFAULTS)
            result["placeholders"] = sorted(PLACEHOLDERS)
        return result

    async def update(self, revision: int, values: dict[str, Any]) -> dict[str, Any]:
        async with self.lock:
            normalized = normalize(values)
            if type(revision) is not int or revision != self.data["revision"]:
                raise AccessError("revision_conflict")
            if normalized != self.data["values"]:
                draft = {"schema": 1, "revision": revision + 1, "values": normalized}
                await self.save(draft)
                self.data = draft
                self.changed()
            return self.public(defaults=True)
