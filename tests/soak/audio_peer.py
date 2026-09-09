"""Loopback-only ISAPI test peer. Never connect this simulator to real equipment."""

import asyncio
import contextlib
from urllib.parse import parse_qs, urlsplit

import httpx
from test_access_engine import Device

from custom_components.hikvision_intercom.client.audio import CHANNEL


class AudioPeer:
    def __init__(self, index):
        self.identity = f"SOAK-{index}"
        self.device = Device()
        self.server = None
        self.tasks = set()
        self.active = None
        self.opens = 0
        self.closes = 0
        self.rx_bytes = 0
        self.tx_bytes = 0
        self.reject_upload = False
        self.header_errors = 0

    async def start(self):
        self.server = await asyncio.start_server(self.handle, "127.0.0.1", 0, limit=8192)
        return self.server.sockets[0].getsockname()[1]

    async def close(self):
        self.server.close()
        await self.server.wait_closed()
        for task in list(self.tasks):
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)

    async def reply(self, writer, code, body=b"", mime="application/xml", extra=""):
        writer.write(
            (
                f"HTTP/1.1 {code} Response\r\nContent-Length: {len(body)}\r\n"
                f"Content-Type: {mime}\r\nConnection: close\r\n{extra}\r\n"
            ).encode()
            + body
        )
        await writer.drain()

    async def handle(self, reader, writer):
        task = asyncio.current_task()
        self.tasks.add(task)
        try:
            async with asyncio.timeout(10):
                head = (await reader.readuntil(b"\r\n\r\n")).decode("ascii")
                method, target, _ = head.splitlines()[0].split(" ")
                headers = dict(
                    line.lower().split(": ", 1) for line in head.splitlines()[1:] if ": " in line
                )
                if not headers.get("authorization", "").startswith("digest "):
                    await self.reply(
                        writer,
                        401,
                        extra=(
                            'WWW-Authenticate: Digest realm="soak",'
                            'nonce="fixture-nonce",qop="auth"\r\n'
                        ),
                    )
                    return
                path = urlsplit(target).path
                if path.endswith("/audioData"):
                    if parse_qs(urlsplit(target).query).get("sessionId") != [self.active]:
                        await self.reply(writer, 403)
                        return
                    if method == "PUT":
                        if "content-length" in headers or "transfer-encoding" in headers:
                            self.header_errors += 1
                            await self.reply(writer, 400)
                            return
                        # Body handling below has the session's lifetime, not this header timeout.
                    else:
                        writer.write(
                            b"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\n"
                            b"Connection: close\r\n\r\n"
                        )
                        await writer.drain()
                else:
                    body = await reader.readexactly(int(headers.get("content-length", "0")))
                    if path == "/ISAPI/System/deviceInfo":
                        response = (
                            "<DeviceInfo><model>DS-KV6124-E1</model>"
                            f"<serialNumber>{self.identity}</serialNumber>"
                            "<firmwareVersion>V3.9.0</firmwareVersion></DeviceInfo>"
                        ).encode()
                    elif path == "/ISAPI/VideoIntercom/callStatus":
                        await self.reply(
                            writer, 200, b'{"CallStatus":{"status":"idle"}}', "application/json"
                        )
                        return
                    elif path == CHANNEL or path == CHANNEL + "/capabilities":
                        opt = ' opt="G.711ulaw"' if path.endswith("capabilities") else ""
                        response = (
                            "<TwoWayAudioChannel><id>1</id><enabled>false</enabled>"
                            f"<audioCompressionType{opt}>G.711ulaw</audioCompressionType>"
                            "</TwoWayAudioChannel>"
                        ).encode()
                    elif path == CHANNEL + "/open":
                        if self.active is not None:
                            await self.reply(writer, 409)
                            return
                        self.opens += 1
                        self.active = f"session-{self.opens}"
                        response = (
                            f"<TwoWayAudioSession><sessionId>{self.active}</sessionId>"
                            "</TwoWayAudioSession>"
                        ).encode()
                    elif path == CHANNEL + "/close":
                        if parse_qs(urlsplit(target).query).get("sessionId") != [self.active]:
                            await self.reply(writer, 403)
                            return
                        self.active = None
                        self.closes += 1
                        response = b"<ResponseStatus><statusCode>1</statusCode></ResponseStatus>"
                    elif path.startswith("/ISAPI/AccessControl/"):
                        if self.device.offline:
                            await self.reply(writer, 503)
                            return
                        result = await self.device.handle(
                            httpx.Request(method, "http://127.0.0.1" + target, content=body)
                        )
                        await self.reply(
                            writer, result.status_code, result.content, "application/json"
                        )
                        return
                    else:
                        await self.reply(writer, 404)
                        return
                    await self.reply(writer, 200, response)
                    return
            owned = self.active
            if method == "GET":
                while self.active == owned:
                    writer.write(b"\xff" * 160)
                    await writer.drain()
                    self.rx_bytes += 160
                    await asyncio.sleep(0.02)
            else:
                while self.active == owned:
                    if self.reject_upload:
                        await self.reply(writer, 503)
                        return
                    packet = await reader.readexactly(160)
                    self.tx_bytes += len(packet)
        except (
            OSError,
            ValueError,
            TimeoutError,
            asyncio.IncompleteReadError,
            asyncio.LimitOverrunError,
        ):
            pass
        finally:
            writer.close()
            with contextlib.suppress(Exception):
                await writer.wait_closed()
            self.tasks.discard(task)
