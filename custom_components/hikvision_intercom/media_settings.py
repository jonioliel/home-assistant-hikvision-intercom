"""Atomic fleet-wide playback preferences, independent of station access data."""

from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable
from copy import deepcopy
from typing import Any
from urllib.parse import urlsplit

from .access.models import AccessError

DEFAULTS = {
    "transport": "webrtc",
    "webrtc_mode": "rtc",
    "fallback_hls": True,
    "go2rtc_url": "",
    "talk_mode": "ptt",
    "tts_engine_id": "",
    "tts_language": "",
    "tts_phrases": [],
}
CORE_FIELDS = {"transport", "webrtc_mode", "fallback_hls", "go2rtc_url"}


def normalize(values: dict[str, Any]) -> dict[str, Any]:
    """Accept older stored media policies while rejecting unknown or malformed fields."""
    if (
        not isinstance(values, dict)
        or not CORE_FIELDS.issubset(values)
        or not set(values).issubset(DEFAULTS)
    ):
        raise AccessError("invalid_fields")
    values = {**deepcopy(DEFAULTS), **values}
    if values["transport"] not in ("hls", "webrtc") or values["webrtc_mode"] not in ("rtc", "mse"):
        raise AccessError("invalid_fields")
    if values["talk_mode"] not in ("ptt", "toggle"):
        raise AccessError("invalid_fields")
    if type(values["fallback_hls"]) is not bool:
        raise AccessError("invalid_fields")
    engine = values["tts_engine_id"]
    language = values["tts_language"]
    phrases = values["tts_phrases"]
    if not isinstance(engine, str) or (
        engine and not re.fullmatch(r"tts\.[a-z0-9_]{1,200}", engine)
    ):
        raise AccessError("invalid_fields")
    if not isinstance(language, str) or (
        language and not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", language)
    ):
        raise AccessError("invalid_fields")
    if not isinstance(phrases, list) or len(phrases) > 10:
        raise AccessError("invalid_fields")
    normalized_phrases: list[str] = []
    for phrase in phrases:
        if not isinstance(phrase, str) or any(ord(char) < 32 for char in phrase):
            raise AccessError("invalid_fields")
        clean = phrase.strip()
        if (
            not clean
            or len(clean) > 160
            or clean.casefold() in {row.casefold() for row in normalized_phrases}
        ):
            raise AccessError("invalid_fields")
        normalized_phrases.append(clean)
    url = values["go2rtc_url"]
    if not isinstance(url, str) or len(url) > 512 or any(ord(c) < 33 for c in url):
        raise AccessError("invalid_fields")
    if url:
        try:
            parts = urlsplit(url)
            if (
                parts.scheme not in ("http", "https")
                or not parts.hostname
                or parts.username
                or parts.password
                or parts.query
                or parts.fragment
                or parts.path not in ("", "/")
                or "\\" in url
                or parts.port == 0
            ):
                raise ValueError
        except ValueError:
            raise AccessError("invalid_fields") from None
    return {**values, "go2rtc_url": url.rstrip("/"), "tts_phrases": normalized_phrases}


class MediaSettings:
    def __init__(
        self, save: Callable[[dict[str, Any]], Awaitable[None]], changed: Callable[[], None]
    ):
        self.save = save
        self.changed = changed
        self.data: dict[str, Any] = {"schema": 1, "revision": 0, "values": deepcopy(DEFAULTS)}
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
            if isinstance(values, dict):
                # An older open panel must not erase newly saved preferences.
                values = {
                    **{
                        key: self.data["values"][key]
                        for key in DEFAULTS
                        if key not in values and key not in CORE_FIELDS
                    },
                    **values,
                }
            values = normalize(values)
            if type(revision) is not int or revision != self.data["revision"]:
                raise AccessError("revision_conflict")
            if values != self.data["values"]:
                draft = {"schema": 1, "revision": revision + 1, "values": values}
                await self.save(draft)
                self.data = draft
                self.changed()
            return self.public()
