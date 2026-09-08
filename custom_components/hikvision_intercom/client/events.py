"""Length-framed alert stream and capability-gated, bounded read-only event queries."""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any
from uuid import uuid4

import httpx

from ..exceptions import (
    HikvisionAuthError,
    HikvisionConnectionError,
    HikvisionDeviceError,
    HikvisionTimeoutError,
    HikvisionUnsupportedError,
    HikvisionValidationError,
)
from .client import ConnectionSettings, HikvisionClient
from .parser import parse_payload
from .transport import LimitedTransport

STREAM_PATH = "/ISAPI/Event/notification/alertStream"
MAX_DOCUMENT = 262_144
MAX_PART = 4_194_304


class EventFrames:
    """Incremental MIME parser for the captured Content-Length framing.

    Some firmware omits boundary in the outer header. We consume each declared
    body exactly, tolerate framing lines, and skip picture bodies without buffering.
    Unsupported framing fails closed and reconnects; no guessing XML delimiters.
    """

    def __init__(self) -> None:
        self.buffer = bytearray()
        self.remaining = 0
        self.document = False
        self.body = bytearray()

    def feed(self, chunk: bytes) -> list[dict[str, Any]]:
        documents: list[dict[str, Any]] = []
        # HTTPX callers supply bounded chunks; enforce this for other callers too.
        if len(chunk) > 65_536:
            raise HikvisionValidationError("Event chunk exceeds limit")
        self.buffer.extend(chunk)
        while self.buffer:
            if self.remaining:
                count = min(self.remaining, len(self.buffer))
                if self.document:
                    self.body.extend(self.buffer[:count])
                del self.buffer[:count]
                self.remaining -= count
                if self.remaining:
                    break
                if self.document:
                    documents.append(parse_payload(bytes(self.body)).data)
                    self.body.clear()
                continue
            end = self.buffer.find(b"\r\n\r\n")
            if end < 0:
                if len(self.buffer) > 8192:
                    raise HikvisionValidationError("Event header exceeds limit")
                break
            if end > 8192:
                raise HikvisionValidationError("Event header exceeds limit")
            headers = bytes(self.buffer[:end])
            del self.buffer[: end + 4]
            lengths = re.findall(
                rb"(?:^|\n)Content-Length:\s*([0-9]{1,8})\r?$", headers, re.I | re.M
            )
            types = re.findall(rb"(?:^|\n)Content-Type:[ \t]*([^\r\n;]+)", headers, re.I)
            if len(lengths) != 1 or len(types) != 1:
                raise HikvisionValidationError("Unsupported event framing")
            self.remaining = int(lengths[0])
            self.document = types[0].strip().lower() in {
                b"application/json",
                b"application/xml",
                b"text/xml",
            }
            if not 0 < self.remaining <= (MAX_DOCUMENT if self.document else MAX_PART):
                raise HikvisionValidationError("Event part exceeds limit")
        return documents


def create_event_session(settings: ConnectionSettings) -> httpx.AsyncClient:
    """One dedicated long-lived connection; Digest challenges remain size bounded."""
    return httpx.AsyncClient(
        transport=LimitedTransport(
            httpx.AsyncHTTPTransport(
                verify=settings.verify_ssl,
                trust_env=False,
                retries=0,
                limits=httpx.Limits(max_connections=1, max_keepalive_connections=1),
            ),
            MAX_DOCUMENT,
            stream_path=STREAM_PATH,
        ),
        trust_env=False,
        follow_redirects=False,
    )


class EventClient:
    def __init__(self, client: HikvisionClient) -> None:
        self.client = client
        self.page_size = 0
        self.position_limit = 0

    async def async_stream(self, session: httpx.AsyncClient) -> AsyncIterator[dict[str, Any]]:
        settings = self.client.settings
        try:
            async with session.stream(
                "GET",
                settings.base_url + STREAM_PATH,
                auth=httpx.DigestAuth(settings.username, settings.password),
                headers={"Accept-Encoding": "identity"},
                timeout=httpx.Timeout(65, connect=5),
                follow_redirects=False,
            ) as response:
                if response.status_code in {401, 403}:
                    raise HikvisionAuthError("Event authentication failed")
                if response.status_code in {404, 405, 501}:
                    raise HikvisionUnsupportedError("Event stream unavailable")
                if response.status_code != 200:
                    raise HikvisionDeviceError("Event stream failed")
                parser = EventFrames()
                async for chunk in response.aiter_bytes():
                    for offset in range(0, len(chunk), 65_536):
                        for document in parser.feed(chunk[offset : offset + 65_536]):
                            yield document
        except httpx.TimeoutException:
            raise HikvisionTimeoutError("Event stream timed out") from None
        except httpx.HTTPError:
            raise HikvisionConnectionError("Event connection failed") from None

    async def async_capabilities(self) -> bool:
        caps = await self.client._get("/ISAPI/AccessControl/AcsEvent/capabilities?format=json")
        root = caps.get("AcsEvent", {})
        cond = root.get("AcsEventCond", {}) if isinstance(root, dict) else {}
        if not isinstance(cond, dict):
            return False
        try:
            size = cond["maxResults"]["@max"]
            position = cond["searchResultPosition"]["@max"]
            if (
                type(size) is not int
                or type(position) is not int
                or not 1 <= size <= 1000
                or position < 0
            ):
                return False
            if not {"startTime", "endTime"} <= cond.keys():
                return False
            if "5" not in str(cond["major"]["@opt"]).split(","):
                return False
        except (KeyError, TypeError):
            return False
        self.page_size = min(size, 30)
        self.position_limit = min(position, 1000)
        return True

    async def async_history(self, start: datetime, end: datetime) -> list[dict[str, Any]]:
        """Return a complete bounded snapshot or raise; never silently advance on gaps."""
        if not self.page_size or start.tzinfo is None or end.tzinfo is None or start >= end:
            raise HikvisionValidationError("Invalid event recovery range")
        search_id = uuid4().hex
        records: list[dict[str, Any]] = []
        seen: set[str] = set()
        total: int | None = None
        async with asyncio.timeout(120):
            while len(records) <= self.position_limit:
                body = {
                    "AcsEventCond": {
                        "searchID": search_id,
                        "searchResultPosition": len(records),
                        "maxResults": self.page_size,
                        "major": 5,
                        "minor": 0,
                        "startTime": start.isoformat(timespec="seconds"),
                        "endTime": end.isoformat(timespec="seconds"),
                        "picEnable": False,
                    }
                }
                data = parse_payload(
                    await self.client._request(
                        "POST",
                        "/ISAPI/AccessControl/AcsEvent?format=json",
                        content=json.dumps(body).encode(),
                        content_type="application/json",
                    )
                ).data.get("AcsEvent")
                if not isinstance(data, dict) or data.get("searchID") != search_id:
                    raise HikvisionValidationError("Invalid event search response")
                count, found = data.get("numOfMatches"), data.get("totalMatches")
                rows = data.get("InfoList", [])
                status = data.get("responseStatusStrg")
                if (
                    type(count) is not int
                    or type(found) is not int
                    or not isinstance(rows, list)
                    or not 0 <= count <= self.page_size
                    or count != len(rows)
                    or not len(records) + count <= found <= 5000
                    or (total is not None and found != total)
                    or not isinstance(status, str)
                    or status not in {"OK", "MORE", "NO MATCH", "NOMATCH"}
                ):
                    raise HikvisionValidationError("Inconsistent event pagination")
                total = found
                page_key = json.dumps(rows, sort_keys=True)
                if count and page_key in seen:
                    raise HikvisionValidationError("Repeated event page")
                seen.add(page_key)
                for row in rows:
                    if not isinstance(row, dict):
                        raise HikvisionValidationError("Invalid event record")
                    records.append(row)
                if len(records) == total and status != "MORE":
                    return records
                if not count or status != "MORE":
                    raise HikvisionValidationError("Incomplete event search")
        raise HikvisionValidationError("Event recovery exceeded page limit")
