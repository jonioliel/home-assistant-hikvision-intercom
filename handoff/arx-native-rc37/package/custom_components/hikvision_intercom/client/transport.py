"""Bound even the response bodies HTTPX consumes during Digest authentication."""

from collections.abc import AsyncIterator

import httpx

from ..exceptions import HikvisionValidationError


class LimitedStream(httpx.AsyncByteStream):
    """Limit raw transport bytes before HTTPX can buffer an authentication reply."""

    def __init__(self, stream: httpx.AsyncByteStream, limit: int) -> None:
        self._stream = stream
        self._limit = limit

    async def __aiter__(self) -> AsyncIterator[bytes]:
        total = 0
        async for chunk in self._stream:
            total += len(chunk)
            if total > self._limit:
                raise HikvisionValidationError("Transport response exceeds size limit")
            yield chunk

    async def aclose(self) -> None:
        await self._stream.aclose()


class LimitedTransport(httpx.AsyncBaseTransport):
    """Delegate connections and TLS to HTTPX with an independent raw-body ceiling."""

    def __init__(
        self, transport: httpx.AsyncBaseTransport, limit: int, *, stream_path: str | None = None
    ) -> None:
        self._transport = transport
        self._limit = limit
        self._stream_path = stream_path

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = await self._transport.handle_async_request(request)
        if response.headers.get("content-encoding", "identity").casefold() != "identity":
            await response.aclose()
            raise HikvisionValidationError("Compressed probe responses are not accepted")
        if not (response.status_code == 200 and request.url.path == self._stream_path):
            response.stream = LimitedStream(response.stream, self._limit)  # type: ignore[arg-type]
        return response

    async def aclose(self) -> None:
        await self._transport.aclose()
