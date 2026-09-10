"""Bounded G.711 audio sessions; ISAPI guide sections 10.1 and 13.7.1.

A session never changes channel configuration or sends a call/door command.
HTTP upload uses the documented persistent, unframed binary body (no HTTP
chunk markers). Device session identifiers and Digest headers stay in memory.
"""

from __future__ import annotations

import asyncio
import contextlib
import re
import socket
import ssl
import time
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import quote

import httpx

from ..exceptions import HikvisionError
from .client import HikvisionClient
from .parser import parse_payload
from .transport import LimitedTransport

CHANNEL = "/ISAPI/System/TwoWayAudio/channels/1"
SAMPLE_RATE = 8000
FRAME_BYTES = 160
PACKET_BYTES = 800
MAX_PACKET_AGE = 0.3
WRITE_TIMEOUT = 0.5
RECEIVE_TIMEOUT = 5.0
SILENCE = b"\xff" * FRAME_BYTES


class AudioError(HikvisionError):
    """Only an allowlisted code, never remote text or a credential, reaches HA."""

    def __init__(self, code: str) -> None:
        super().__init__("Audio session could not complete")
        self.code = code


def validate_channel(payload: dict[str, Any], capabilities: dict[str, Any]) -> None:
    """Support the observed channel and documented 8 kHz mu-law framing only."""
    channel = payload.get("TwoWayAudioChannel")
    caps = capabilities.get("TwoWayAudioChannel")
    if not isinstance(channel, dict) or not isinstance(caps, dict):
        raise AudioError("audio_unsupported")
    codec = caps.get("audioCompressionType")
    options = codec.get("@opt", "") if isinstance(codec, dict) else ""
    if (
        channel.get("id") != "1"
        or caps.get("id") != "1"
        or not isinstance(options, str)
        or "G.711ulaw" not in options.split(",")
        or channel.get("audioCompressionType") != "G.711ulaw"
        or channel.get("audioInboundCompressionType", "G.711ulaw") != "G.711ulaw"
        or channel.get("audioSamplingRate", "8") not in ("8", "8.0", "8.00", 8)
        or channel.get("audioBitRate", "64") not in ("64", 64)
        or channel.get("lineOutForbidden", "false") not in ("false", False)
        or channel.get("micInForbidden", "false") not in ("false", False)
    ):
        raise AudioError("audio_unsupported")
    # Firmware 3.9.0 reports false while closed and true after a successful open.
    # No PUT to the channel configuration is necessary or performed.


class AudioSession:
    """Own one station's control, receive and transmit lifetimes independently."""

    def __init__(self, client: HikvisionClient) -> None:
        self.control = HikvisionClient(
            client._session, client.settings, expected_identity=client._expected_identity
        )
        settings = client.settings
        self.http = httpx.AsyncClient(
            transport=LimitedTransport(
                httpx.AsyncHTTPTransport(
                    verify=settings.verify_ssl,
                    trust_env=False,
                    retries=0,
                    limits=httpx.Limits(max_connections=2, max_keepalive_connections=1),
                ),
                8192,
                stream_path=CHANNEL + "/audioData",
            ),
            trust_env=False,
            follow_redirects=False,
        )
        self.tls: ssl.SSLContext | None = None
        if settings.scheme == "https":
            self.tls = ssl.create_default_context()
            if not settings.verify_ssl:
                self.tls.check_hostname = False
                self.tls.verify_mode = ssl.CERT_NONE
        self.session_id: str | None = None
        self.failure: str | None = None
        self.close_confirmed: bool | None = None
        self.incoming: asyncio.Queue[tuple[float, bytes]] = asyncio.Queue(maxsize=3)
        self.outgoing: asyncio.Queue[tuple[float, bytes]] = asyncio.Queue(maxsize=3)
        self._tasks: list[asyncio.Task[None]] = []
        self._writer: asyncio.StreamWriter | None = None
        self._closed = False
        self._close_lock = asyncio.Lock()
        self._mute_epoch = 0
        self._last_send = 0.0
        self._credit = 2.0
        self.upload_http_status: int | None = None
        self.received_bytes = 0
        self.sent_bytes = 0
        self.microphone_bytes = 0
        self.dropped_packets = 0

    def _path(self, operation: str) -> str:
        if self.session_id is None:
            raise AudioError("audio_not_started")
        return CHANNEL + "/" + operation + "?sessionId=" + quote(self.session_id, safe="")

    async def start(self) -> None:
        if self._closed or self.session_id is not None:
            raise AudioError("audio_not_started")
        if self.control._expected_identity is None:
            raise AudioError("audio_identity_required")
        async with asyncio.timeout(20):
            await self.control.async_confirm_identity()
            validate_channel(
                await self.control._get(CHANNEL),
                await self.control._get(CHANNEL + "/capabilities"),
            )
            payload = parse_payload(await self.control._request("PUT", CHANNEL + "/open")).data
            root = payload.get("TwoWayAudioSession")
            value = root.get("sessionId") if isinstance(root, dict) else None
            if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", value):
                # An ambiguous open is not retried or followed by an unowned close.
                raise AudioError("audio_open_unconfirmed")
            self.session_id = value
            await self._connect_upload()
        self._tasks = [
            asyncio.create_task(self._guard(self._receive)),
            asyncio.create_task(self._guard(self._transmit)),
            asyncio.create_task(self._guard(self._upload_response)),
        ]

    async def _connect_upload(self) -> None:
        """Obtain a fresh PUT challenge before consuming any microphone frames."""
        settings = self.control.settings
        path = self._path("audioData")
        request = self.http.build_request(
            "PUT",
            settings.base_url + path,
            content=b"",
            headers={"Accept-Encoding": "identity", "Content-Type": "application/octet-stream"},
        )
        flow = httpx.DigestAuth(settings.username, settings.password).auth_flow(request)
        try:
            challenge = await self.http.send(next(flow), stream=True)
            try:
                if challenge.status_code != 401:
                    raise AudioError("audio_auth_failed")
                # Bounded transport also limits bodies drained during authentication.
                await challenge.aread()
                authenticated = flow.send(challenge)
                authorization = authenticated.headers.get("Authorization", "")
            finally:
                await challenge.aclose()
        except (StopIteration, httpx.HTTPError, NotImplementedError, KeyError, ValueError):
            raise AudioError("audio_auth_failed") from None
        finally:
            flow.close()
        if (
            not authorization.startswith("Digest ")
            or "\r" in authorization
            or "\n" in authorization
        ):
            raise AudioError("audio_auth_failed")
        async with asyncio.timeout(5):
            self._reader, self._writer = await asyncio.open_connection(
                settings.host,
                settings.port,
                ssl=self.tls,
                server_hostname=settings.host if self.tls else None,
                limit=8192,
            )
            # Bound user-space buffering and request a small kernel send buffer.
            # OS minimums/TCP buffering vary: this is not an end-to-end latency guarantee.
            self._writer.transport.set_write_buffer_limits(high=1600, low=800)
            sock = self._writer.get_extra_info("socket")
            if sock is not None:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 1600)
            # ISAPI 10.1: persistent binary upload, without Content-Length.
            # HTTP chunk framing would insert non-audio bytes in this firmware's stream.
            authority = httpx.URL(settings.base_url).netloc.decode("ascii")
            header = (
                f"PUT {path} HTTP/1.1\r\nHost: {authority}\r\n"
                f"Authorization: {authorization}\r\n"
                "Connection: keep-alive\r\nContent-Type: application/octet-stream\r\n"
                "Accept-Encoding: identity\r\n\r\n"
            )
            self._writer.write(header.encode("ascii"))
            await self._writer.drain()

    async def _guard(self, operation: Callable[[], Awaitable[None]]) -> None:
        try:
            await operation()
        except asyncio.CancelledError:
            raise
        except Exception:
            self.failure = "audio_connection_lost"
        else:
            if not self._closed:
                self.failure = "audio_connection_lost"

    async def _upload_response(self) -> None:
        # Observed firmware acknowledges PUT with HTTP 200, then keeps it open.
        # Retain only the numeric status; it confirms transport, not speaker playback.
        # A rejected request or peer closure ends the session without replay.
        line = await self._reader.readline()
        if line:
            status = re.fullmatch(rb"HTTP/1\.[01] ([1-5][0-9]{2}) [^\r\n]*\r\n", line)
            if status:
                self.upload_http_status = int(status.group(1))
            if self.upload_http_status != 200:
                raise AudioError("audio_connection_lost")
            headers = await self._reader.readuntil(b"\r\n\r\n")
            if len(headers) > 8192:
                raise AudioError("audio_connection_lost")
            await self._reader.read(1)

    async def _receive(self) -> None:
        settings = self.control.settings
        async with self.http.stream(
            "GET",
            settings.base_url + self._path("audioData"),
            auth=httpx.DigestAuth(settings.username, settings.password),
            headers={"Accept-Encoding": "identity", "Content-Type": "application/octet-stream"},
            timeout=httpx.Timeout(5, connect=4),
        ) as response:
            kind = response.headers.get("content-type", "").split(";")[0].strip().lower()
            # The misspelled content type is captured from firmware 3.9.0 build 260115.
            if response.status_code != 200 or kind not in {
                "application/octet-stream",
                "application/octem-strem",
            }:
                raise AudioError("audio_connection_lost")
            # Limit time to a complete packet, including a peer trickling bytes.
            async with asyncio.timeout(RECEIVE_TIMEOUT) as watchdog:
                async for packet in response.aiter_bytes(PACKET_BYTES):
                    if len(packet) != PACKET_BYTES:
                        raise AudioError("audio_connection_lost")
                    self.received_bytes += len(packet)
                    if self.incoming.full():
                        self.incoming.get_nowait()
                        self.dropped_packets += 1
                    self.incoming.put_nowait((time.monotonic(), packet))
                    watchdog.reschedule(asyncio.get_running_loop().time() + RECEIVE_TIMEOUT)

    async def _transmit(self) -> None:
        pending = b""
        expires = 0.0
        mute_epoch = self._mute_epoch
        deadline = time.monotonic()
        while True:
            now = time.monotonic()
            if now > expires or mute_epoch != self._mute_epoch:
                pending = b""
                mute_epoch = self._mute_epoch
            if not pending:
                while not self.outgoing.empty():
                    received, packet = self.outgoing.get_nowait()
                    if now - received <= 0.25:
                        pending, expires = packet, received + 0.25
                        break
            from_microphone = bool(pending)
            frame = pending[:FRAME_BYTES] if pending else SILENCE
            pending = pending[FRAME_BYTES:]
            if self._writer is None:
                raise AudioError("audio_connection_lost")
            async with asyncio.timeout(WRITE_TIMEOUT):
                self._writer.write(frame)
                await self._writer.drain()
            self.sent_bytes += len(frame)
            if from_microphone:
                self.microphone_bytes += len(frame)
            deadline += 0.02
            now = time.monotonic()
            if now - deadline > 0.1:
                deadline = now
                pending = b""
            await asyncio.sleep(max(0, deadline - now))

    def send(self, packet: bytes) -> None:
        if self._closed or self.failure or self.session_id is None:
            raise AudioError("audio_connection_lost")
        if not isinstance(packet, bytes) or len(packet) != PACKET_BYTES:
            raise AudioError("audio_invalid_packet")
        now = time.monotonic()
        self._credit = min(2.0, self._credit + (now - self._last_send) * 10)
        self._last_send = now
        if self._credit < 1 or self.outgoing.full():
            raise AudioError("audio_backpressure")
        self._credit -= 1
        self.outgoing.put_nowait((now, packet))

    async def receive(self) -> bytes:
        if self._closed or self.failure:
            raise AudioError("audio_connection_lost")
        try:
            async with asyncio.timeout(2):
                while True:
                    received, packet = await self.incoming.get()
                    if self._closed or self.failure:
                        raise AudioError("audio_connection_lost")
                    if time.monotonic() - received <= MAX_PACKET_AGE:
                        return packet
                    self.dropped_packets += 1
        except TimeoutError:
            return b""

    def mute(self) -> None:
        self._mute_epoch += 1
        while not self.outgoing.empty():
            self.outgoing.get_nowait()
        # The next 20 ms frame observes the new mute epoch.

    async def close(self) -> None:
        async with self._close_lock:
            if self._closed:
                return
            self._closed = True
            for task in self._tasks:
                task.cancel()
            await asyncio.gather(*self._tasks, return_exceptions=True)
            if self._writer:
                # Stop drops queued microphone frames instead of flushing old speech.
                # Bytes already accepted by the peer cannot be recalled.
                self._writer.transport.abort()
                with contextlib.suppress(Exception):
                    async with asyncio.timeout(2):
                        await self._writer.wait_closed()
            await self.http.aclose()
            if self.session_id is not None:
                try:
                    # A replaced device must never receive a stale session's close.
                    async with asyncio.timeout(8):
                        await self.control.async_confirm_identity()
                        payload = parse_payload(
                            await self.control._request("PUT", self._path("close"), deadline=5)
                        ).data
                    root = payload.get("ResponseStatus", {})
                    self.close_confirmed = isinstance(root, dict) and root.get("statusCode") in (
                        "0",
                        "1",
                        0,
                        1,
                    )
                except (HikvisionError, TimeoutError):
                    self.close_confirmed = False
            self.mute()
            while not self.incoming.empty():
                self.incoming.get_nowait()
