"""Audio framing, identity, cleanup and flow control without a physical station."""

import asyncio
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from custom_components.hikvision_intercom.client.audio import (
    CHANNEL,
    AudioError,
    AudioSession,
    validate_channel,
)
from custom_components.hikvision_intercom.client.client import ConnectionSettings, HikvisionClient
from custom_components.hikvision_intercom.exceptions import HikvisionValidationError

CONFIG = {
    "TwoWayAudioChannel": {"id": "1", "enabled": "false", "audioCompressionType": "G.711ulaw"}
}
CAPS = {"TwoWayAudioChannel": {"id": "1", "audioCompressionType": {"@opt": "G.711ulaw"}}}
OPEN = b"<TwoWayAudioSession><sessionId>session-a</sessionId></TwoWayAudioSession>"
CLOSE = b"<ResponseStatus><statusCode>1</statusCode></ResponseStatus>"


@pytest.fixture
async def audio():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: httpx.Response(200))
    ) as http:
        client = HikvisionClient(
            http,
            ConnectionSettings("192.0.2.1", "demo", "demo-secret"),
            expected_identity="device-a",
        )
        session = AudioSession(client)
        session.control.async_confirm_identity = AsyncMock()
        session.control._get = AsyncMock(side_effect=[CONFIG, CAPS])
        session.control._request = AsyncMock(side_effect=[OPEN, CLOSE])
        yield session
        await session.close()


def test_observed_disabled_flag_does_not_require_configuration_write():
    validate_channel(CONFIG, CAPS)


@pytest.mark.parametrize(
    "field,value",
    [
        ("id", "2"),
        ("audioCompressionType", "AAC"),
        ("audioInboundCompressionType", "G.711alaw"),
        ("audioSamplingRate", "16"),
        ("audioBitRate", "128"),
        ("lineOutForbidden", "true"),
        ("micInForbidden", "true"),
    ],
)
def test_reject_incompatible_channel(field, value):
    with pytest.raises(AudioError, match="Audio session"):
        validate_channel(
            {"TwoWayAudioChannel": {**CONFIG["TwoWayAudioChannel"], field: value}}, CAPS
        )


@pytest.mark.parametrize(
    "caps",
    [
        {},
        {"TwoWayAudioChannel": {"id": "1"}},
        {"TwoWayAudioChannel": {"id": "1", "audioCompressionType": {"@opt": "AAC"}}},
    ],
)
def test_requires_current_capability_evidence(caps):
    with pytest.raises(AudioError):
        validate_channel(CONFIG, caps)


async def test_no_open_for_identity_mismatch(audio):
    audio.control.async_confirm_identity.side_effect = HikvisionValidationError("mismatch")
    with pytest.raises(HikvisionValidationError):
        await audio.start()
    audio.control._request.assert_not_called()


async def test_failed_upload_closes_only_owned_session_once(audio):
    with patch.object(
        audio, "_connect_upload", AsyncMock(side_effect=AudioError("audio_auth_failed"))
    ):
        with pytest.raises(AudioError):
            await audio.start()
    await audio.close()
    await audio.close()
    assert audio.control._request.call_count == 2
    assert audio.control._request.call_args.args == ("PUT", CHANNEL + "/close?sessionId=session-a")
    assert audio.close_confirmed is True
    assert audio.http.is_closed


@pytest.mark.parametrize(
    "payload",
    [
        b"<TwoWayAudioSession><sessionId>../other?x=y</sessionId></TwoWayAudioSession>",
        b"<ResponseStatus><statusCode>1</statusCode></ResponseStatus>",
    ],
)
async def test_ambiguous_open_never_retries_or_closes_an_unowned_channel(audio, payload):
    audio.control._request.side_effect = [payload]
    with pytest.raises(AudioError) as err:
        await audio.start()
    assert err.value.code == "audio_open_unconfirmed"
    await audio.close()
    audio.control._request.assert_awaited_once()


async def test_identity_change_prevents_stale_close(audio):
    audio.session_id = "owned"
    audio.control.async_confirm_identity.side_effect = HikvisionValidationError("replaced")
    await audio.close()
    assert audio.close_confirmed is False
    audio.control._request.assert_not_called()


async def test_receive_queue_discards_stale_audio_and_bounds_latency(audio):
    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            for i in range(10):
                yield bytes([i]) * 800

    await audio.http.aclose()
    audio.http = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda r: httpx.Response(
                200, headers={"content-type": "application/octem-strem"}, stream=Stream()
            )
        )
    )
    audio.session_id = "owned"
    await audio._receive()
    assert audio.incoming.qsize() == 3
    assert audio.dropped_packets == 7
    assert await audio.receive() == bytes([7]) * 800
    assert audio.received_bytes == 8000


async def test_malformed_audio_response_is_not_played(audio):
    await audio.http.aclose()
    audio.http = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda r: httpx.Response(200, headers={"content-type": "text/xml"}, content=b"<error/>")
        )
    )
    audio.session_id = "owned"
    with pytest.raises(AudioError):
        await audio._receive()
    assert audio.incoming.empty()


async def test_send_enforces_size_burst_budget_and_mute(audio):
    audio.session_id = "owned"
    with pytest.raises(AudioError):
        audio.send(b"x" * 801)
    with patch("custom_components.hikvision_intercom.client.audio.time.monotonic", return_value=5):
        audio.send(b"x" * 800)
        audio.send(b"y" * 800)
        with pytest.raises(AudioError) as err:
            audio.send(b"z" * 800)
        assert err.value.code == "audio_backpressure"
    audio.mute()
    assert audio.outgoing.empty()


async def test_upload_has_fresh_digest_and_raw_fixed_size_frames(audio):
    received = asyncio.Future()
    release = asyncio.Event()

    async def peer(reader, writer):
        try:
            header = await reader.readuntil(b"\r\n\r\n")
            body = await reader.readexactly(320)
            received.set_result((header, body))
            await release.wait()
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(peer, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    audio.control.settings = ConnectionSettings("127.0.0.1", "demo", "demo-secret", port=port)
    await audio.http.aclose()
    challenges = []

    def challenge(request):
        challenges.append((request.method, request.content, dict(request.headers)))
        return httpx.Response(
            401,
            headers={"www-authenticate": 'Digest realm="station",nonce="fresh-nonce",qop="auth"'},
        )

    audio.http = httpx.AsyncClient(transport=httpx.MockTransport(challenge))
    audio.session_id = "owned"
    task = None
    try:
        await audio._connect_upload()
        task = asyncio.create_task(audio._transmit())
        header, body = await asyncio.wait_for(received, 2)
        assert header.startswith(b"PUT " + (CHANNEL + "/audioData?sessionId=owned").encode())
        assert b"Authorization: Digest " in header
        assert b"demo-secret" not in header
        assert b"Content-Length" not in header and b"Transfer-Encoding" not in header
        assert body == b"\xff" * 320
        assert len(challenges) == 1 and challenges[0][0] == "PUT"
        assert challenges[0][1] == b"" and "authorization" not in challenges[0][2]
    finally:
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        release.set()
        await audio.close()
        server.close()
        await server.wait_closed()


async def test_cancelling_receive_does_not_consume_future_packets(audio):
    audio.session_id = "owned"
    task = asyncio.create_task(audio.receive())
    await asyncio.sleep(0)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    audio.incoming.put_nowait(b"x" * 800)
    assert await audio.receive() == b"x" * 800


async def test_session_requires_pinned_station_identity(audio):
    audio.control._expected_identity = None
    with pytest.raises(AudioError) as err:
        await audio.start()
    assert err.value.code == "audio_identity_required"
    audio.control._request.assert_not_called()
