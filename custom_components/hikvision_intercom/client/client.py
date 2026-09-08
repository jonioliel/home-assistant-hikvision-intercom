"""Async production transport for observed DS-KV6124-E1 contracts."""

from __future__ import annotations

import asyncio
import re
import time
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote

import httpx

from ..exceptions import (
    HikvisionAuthError,
    HikvisionBusyError,
    HikvisionConnectionError,
    HikvisionDeviceError,
    HikvisionError,
    HikvisionTimeoutError,
    HikvisionUnsupportedError,
    HikvisionValidationError,
)
from ..hardening import RequestMetrics
from .parser import check_response_status, find_values, parse_payload
from .probe import validate_host
from .transport import LimitedTransport

MAX_RESPONSE = 1_048_576
MAX_IMAGE = 4_194_304
SUPPORTED_MODEL = "DS-KV6124-E1"


@dataclass(frozen=True, slots=True)
class ConnectionSettings:
    """Credentials never participate in representations or entity state."""

    host: str = field(repr=False)
    username: str = field(repr=False)
    password: str = field(repr=False)
    scheme: str = "http"
    port: int = 80
    verify_ssl: bool = True
    rtsp_port: int = 554

    def __post_init__(self) -> None:
        if not isinstance(self.host, str):
            raise HikvisionValidationError("Invalid host")
        object.__setattr__(self, "host", validate_host(self.host))
        if self.scheme not in {"http", "https"} or type(self.verify_ssl) is not bool:
            raise HikvisionValidationError("Invalid connection security settings")
        if any(type(p) is not int or not 1 <= p <= 65535 for p in (self.port, self.rtsp_port)):
            raise HikvisionValidationError("Invalid port")
        if any(
            not isinstance(v, str) or not 1 <= len(v) <= 256 for v in (self.username, self.password)
        ):
            raise HikvisionValidationError("Credentials are required")

    @classmethod
    def from_mapping(cls, data: Mapping[str, Any]) -> ConnectionSettings:
        """Accept saved connection data without accepting an arbitrary URL."""
        return cls(
            host=data["host"],
            username=data["username"],
            password=data["password"],
            scheme=data.get("scheme", "http"),
            port=data.get("port", 80),
            verify_ssl=data.get("verify_ssl", True),
            rtsp_port=data.get("rtsp_port", 554),
        )

    @property
    def base_url(self) -> str:
        """Return a URL with no embedded credentials."""
        return f"{self.scheme}://{self.host}:{self.port}"

    def rtsp_source(self) -> str:
        """Private backend-only source; never return through diagnostics or websocket."""
        username = quote(self.username, safe="")
        password = quote(self.password, safe="")
        return f"rtsp://{username}:{password}@{self.host}:{self.rtsp_port}/Streaming/Channels/101"


@dataclass(frozen=True, slots=True)
class StationProfile:
    """Only device identity and observed core capabilities, never credentials."""

    unique_id: str = field(repr=False)
    model: str
    firmware: str
    serial: str = field(repr=False)
    api_door_ids: tuple[int, ...] = ()
    call_states: tuple[str, ...] = ()
    snapshot: bool = False
    stream: bool = False


@dataclass(frozen=True, slots=True)
class CallState:
    """Keep unknown raw enums without inventing transitions or answered calls."""

    normalized: str
    raw: str


def normalize_call_state(raw: object) -> CallState:
    """Map documented and device-advertised enums; onCall is busy, not answer proof."""
    if not isinstance(raw, str) or not raw or len(raw) > 64:
        raise HikvisionValidationError("Invalid call status")
    return CallState(
        {"idle": "idle", "ring": "ringing", "onCall": "in_call"}.get(raw, "unknown"), raw
    )


def create_session(settings: ConnectionSettings) -> httpx.AsyncClient:
    """Construct in HA's executor because TLS context initialization can read files."""
    transport = LimitedTransport(
        httpx.AsyncHTTPTransport(
            verify=settings.verify_ssl,
            trust_env=False,
            retries=0,
            limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
        ),
        MAX_IMAGE,
    )
    return httpx.AsyncClient(transport=transport, trust_env=False, follow_redirects=False)


class HikvisionClient:
    """Inject a pooled session; serialize requests and never retry physical writes."""

    def __init__(
        self,
        session: httpx.AsyncClient,
        settings: ConnectionSettings,
        *,
        enabled_doors: frozenset[int] = frozenset(),
        expected_identity: str | None = None,
    ) -> None:
        if len(enabled_doors) > 1 or any(
            type(i) is not int or i not in {1, 2} for i in enabled_doors
        ):
            raise HikvisionValidationError(
                "Exactly one active relay or camera-only mode is supported"
            )
        if expected_identity is not None and (
            not isinstance(expected_identity, str) or not 1 <= len(expected_identity) <= 256
        ):
            raise HikvisionValidationError("Invalid expected station identity")
        self.metrics = RequestMetrics()
        self._expected_identity = expected_identity
        self._session = session
        self.settings = settings
        self.enabled_doors = enabled_doors
        self._io_lock = asyncio.Lock()
        self._write_lock = asyncio.Lock()
        self._last_unlock = float("-inf")
        self._snapshot: tuple[float, bytes] | None = None
        self._snapshot_lock = asyncio.Lock()

    async def _request(
        self,
        method: str,
        path: str,
        *,
        content: bytes | None = None,
        image: bool = False,
        content_type: str = "application/xml",
    ) -> bytes:
        """Private fixed-path primitive, bounded including queue and digest exchange."""
        started = time.monotonic()
        failed = True
        try:
            async with asyncio.timeout(10), self._io_lock:
                headers = {"Accept-Encoding": "identity"}
                if content is not None:
                    headers["Content-Type"] = content_type
                async with self._session.stream(
                    method,
                    self.settings.base_url + path,
                    content=content,
                    auth=httpx.DigestAuth(self.settings.username, self.settings.password),
                    headers=headers,
                    timeout=httpx.Timeout(6, connect=4),
                    follow_redirects=False,
                ) as response:
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > (MAX_IMAGE if image else MAX_RESPONSE):
                            raise HikvisionValidationError("Device response exceeds size limit")
                    if response.status_code in {401, 403}:
                        raise HikvisionAuthError("Device authentication or authorization failed")
                    if response.status_code in {404, 405, 501}:
                        raise HikvisionUnsupportedError("Device endpoint is unavailable")
                    if response.status_code in {429, 503}:
                        raise HikvisionBusyError("Device is busy")
                    if body.lstrip().startswith((b"{", b"<")):
                        check_response_status(parse_payload(bytes(body)).data)
                    if response.status_code != 200:
                        raise HikvisionDeviceError("Device request failed")
                    failed = False
                    return bytes(body)
        except (TimeoutError, httpx.TimeoutException):
            raise HikvisionTimeoutError("Device request timed out; no automatic retry") from None
        except httpx.HTTPError:
            raise HikvisionConnectionError(
                "Device communication failed; no automatic retry"
            ) from None

        finally:
            self.metrics.record(time.monotonic() - started, failed)

    async def _get(self, path: str) -> dict[str, Any]:
        return parse_payload(await self._request("GET", path)).data

    async def async_device_info(self) -> tuple[str, str, str, str]:
        """Get a stable identity before allowing commands to an existing entry."""
        payload = await self._get("/ISAPI/System/deviceInfo")
        info = payload.get("DeviceInfo")
        if not isinstance(info, dict):
            raise HikvisionValidationError("Missing device information")
        model = info.get("model")
        if model != SUPPORTED_MODEL:
            raise HikvisionUnsupportedError("This device model has not been commissioned")
        serial = info.get("serialNumber", "")
        mac = info.get("macAddress", "")
        if not isinstance(serial, str) or len(serial) > 256:
            raise HikvisionValidationError("Invalid device identity")
        serial = serial.strip()
        unique_id = serial or (
            "mac_" + mac.lower().replace(":", "")
            if isinstance(mac, str) and re.fullmatch(r"(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}", mac)
            else ""
        )
        if not unique_id:
            raise HikvisionValidationError("Device did not provide a stable identity")
        firmware = " ".join(
            str(info.get(k, "")) for k in ("firmwareVersion", "firmwareReleasedDate")
        ).strip()
        return unique_id, model, firmware[:128], serial

    async def async_call_status(self) -> CallState:
        """Read the firmware's exact CallStatus.status field."""
        payload = await self._get("/ISAPI/VideoIntercom/callStatus?format=json")
        wrapper = payload.get("CallStatus")
        if not isinstance(wrapper, dict):
            raise HikvisionValidationError("Missing call status")
        raw = wrapper.get("status")
        state = normalize_call_state(raw)
        if any(
            secret and secret in state.raw
            for secret in (self.settings.password, self.settings.username)
        ):
            return CallState("unknown", "REDACTED")
        return state

    async def async_profile(self) -> StationProfile:
        """Observe capabilities; optional rejection never enables a feature."""
        unique_id, model, firmware, serial = await self.async_device_info()
        await self.async_call_status()

        async def optional(path: str) -> dict[str, Any]:
            try:
                return await self._get(path)
            except HikvisionAuthError:
                raise
            except HikvisionError:
                return {}

        calls = await optional("/ISAPI/VideoIntercom/callStatus/capabilities?format=json")
        wrapper = calls.get("CallStatus", {})
        status = wrapper.get("status") if isinstance(wrapper, dict) else None
        options = status.get("@opt", []) if isinstance(status, dict) else []
        call_states = (
            tuple(s for s in options if isinstance(s, str) and len(s) <= 64)
            if isinstance(options, list)
            else ()
        )
        remote = await optional("/ISAPI/AccessControl/RemoteControl/door/capabilities")
        doors: tuple[int, ...] = ()
        data = remote.get("RemoteControlDoor", {})
        if isinstance(data, dict) and isinstance(data.get("doorNo"), dict):
            bounds = data["doorNo"]
            commands = data.get("cmd", {})
            option_text = commands.get("@opt") if isinstance(commands, dict) else None
            allowed = option_text.split(",") if isinstance(option_text, str) else []
            try:
                low, high = int(bounds["@min"]), int(bounds["@max"])
                if 1 <= low <= high <= 2 and "open" in allowed:
                    doors = tuple(range(low, high + 1))
            except (KeyError, TypeError, ValueError):
                pass
        streaming = await optional("/ISAPI/Streaming/channels/101")
        channel = streaming.get("StreamingChannel")
        video = channel.get("Video") if isinstance(channel, dict) else None
        stream = bool(
            isinstance(channel, dict)
            and str(channel.get("id")) == "101"
            and str(channel.get("enabled")).lower() == "true"
            and isinstance(video, dict)
            and str(video.get("enabled")).lower() == "true"
        )
        snapshot = False
        try:
            await self.async_snapshot()
            snapshot = True
        except HikvisionAuthError:
            raise
        except HikvisionError:
            pass
        return StationProfile(
            unique_id, model, firmware, serial, doors, call_states, snapshot, stream
        )

    async def async_snapshot(self) -> bytes:
        """Coalesce frontend requests and retain a JPEG only briefly in memory."""
        async with self._snapshot_lock:
            if self._snapshot and time.monotonic() - self._snapshot[0] < 2:
                return self._snapshot[1]
            data = await self._request("GET", "/ISAPI/Streaming/channels/101/picture", image=True)
            if not data.startswith(b"\xff\xd8") or not data.endswith(b"\xff\xd9"):
                raise HikvisionValidationError("Device did not return a complete JPEG")
            self._snapshot = (time.monotonic(), data)
            return data

    async def async_confirm_identity(self) -> None:
        """A running entry must not write to a different device after address reassignment."""
        if self._expected_identity is not None:
            identity, *_ = await self.async_device_info()
            if identity != self._expected_identity:
                raise HikvisionValidationError("Station identity changed before operation")

    async def async_unlock(self, door_id: int) -> None:
        """Send one momentary release only to the explicitly selected API output."""
        if type(door_id) is not int or door_id not in self.enabled_doors:
            raise HikvisionValidationError("Door is not enabled in this integration")
        async with self._write_lock:
            if time.monotonic() - self._last_unlock < 1:
                raise HikvisionBusyError("A door command was just attempted")
            self._last_unlock = time.monotonic()
            await self.async_confirm_identity()
            body = (
                b'<RemoteControlDoor version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">'
                b"<cmd>open</cmd></RemoteControlDoor>"
            )
            response = parse_payload(
                await self._request(
                    "PUT",
                    f"/ISAPI/AccessControl/RemoteControl/door/{door_id}",
                    content=body,
                )
            ).data
            codes = find_values(response, "statusCode")
            if not codes or any(str(code) != "1" for code in codes):
                raise HikvisionDeviceError("Door command was not acknowledged")
