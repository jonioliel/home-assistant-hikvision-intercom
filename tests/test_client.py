"""Production protocol failures, permissions and concurrency boundaries."""

import asyncio
from dataclasses import replace
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from custom_components.hikvision_intercom.client.client import (
    CallState,
    ConnectionSettings,
    HikvisionClient,
    normalize_call_state,
)
from custom_components.hikvision_intercom.configuration import managed_locks
from custom_components.hikvision_intercom.exceptions import (
    HikvisionAuthError,
    HikvisionBusyError,
    HikvisionConnectionError,
    HikvisionDeviceError,
    HikvisionTimeoutError,
    HikvisionUnsupportedError,
    HikvisionValidationError,
)

SETTINGS = ConnectionSettings("192.0.2.10", "demo-user", "demo-secret")
OK = b"<ResponseStatus><statusCode>1</statusCode><statusString>OK</statusString></ResponseStatus>"
INFO = {
    "DeviceInfo": {
        "model": "DS-KV6124-E1",
        "serialNumber": "DEMO-SERIAL",
        "firmwareVersion": "V3.9.0",
    }
}


@pytest.mark.parametrize(
    "change",
    [
        {"host": "https://example.com/path"},
        {"host": "user@example.com"},
        {"port": True},
        {"port": 65536},
        {"rtsp_port": 0},
        {"scheme": "file"},
        {"verify_ssl": "false"},
        {"password": ""},
        {"username": ""},
    ],
)
def test_connection_validation(change):
    with pytest.raises(HikvisionValidationError):
        replace(SETTINGS, **change)


def test_private_connection_representation_and_rtsp_encoding():
    settings = replace(SETTINGS, username="demo@user", password="a/b@c:# d")
    assert "192.0.2.10" not in repr(settings)
    assert "demo@user" not in repr(settings)
    assert (
        settings.rtsp_source()
        == "rtsp://demo%40user:a%2Fb%40c%3A%23%20d@192.0.2.10:554/Streaming/Channels/101"
    )
    assert "@" not in settings.base_url


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("idle", "idle"), ("ring", "ringing"), ("onCall", "in_call"), ("futureState", "unknown")],
)
def test_call_enum_preserves_unknown(raw, expected):
    assert normalize_call_state(raw) == CallState(expected, raw)


@pytest.mark.parametrize("raw", [None, {}, 3, "", "x" * 65])
def test_bad_call_enum(raw):
    with pytest.raises(HikvisionValidationError):
        normalize_call_state(raw)


@pytest.mark.parametrize(
    "records",
    [
        None,
        {},
        [{"physical_index": 2, "api_id": 2, "confirmed": True}],
        [{"physical_index": True, "api_id": 1, "confirmed": True}],
        [{"physical_index": 1, "api_id": True, "confirmed": True}],
        [{"physical_index": 1, "api_id": 65535, "confirmed": True}],
        [{"physical_index": 1, "api_id": 1, "confirmed": False}],
        [{}, {}],
    ],
)
def test_saved_mapping_is_not_permission_without_confirmation(records):
    with pytest.raises(HikvisionValidationError):
        managed_locks({"locks": records})


def test_camera_only_and_single_confirmed_relay():
    assert managed_locks({}) == ()
    assert (
        managed_locks({"locks": [{"physical_index": 1, "api_id": 2, "confirmed": True}]})[0].api_id
        == 2
    )


@pytest.mark.parametrize("door", [0, 2, 65535, True, "1"])
async def test_unselected_unlock_rejected_before_io(door):
    handler = AsyncMock(return_value=httpx.Response(200, content=OK))
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        client = HikvisionClient(session, SETTINGS, enabled_doors=frozenset({1}))
        with pytest.raises(HikvisionValidationError):
            await client.async_unlock(door)
    handler.assert_not_called()


async def test_unlock_exact_payload_no_retries_and_repeat_guard():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, content=OK)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        client = HikvisionClient(session, SETTINGS, enabled_doors=frozenset({1}))
        await client.async_unlock(1)
        with pytest.raises(HikvisionBusyError):
            await client.async_unlock(1)
    assert len(requests) == 1
    assert requests[0].method == "PUT"
    assert requests[0].url.path == "/ISAPI/AccessControl/RemoteControl/door/1"
    assert (
        requests[0].content
        == b'<RemoteControlDoor version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><cmd>open</cmd></RemoteControlDoor>'
    )


@pytest.mark.parametrize(
    ("status", "body", "error"),
    [
        (401, b"unauthorized", HikvisionAuthError),
        (403, b"", HikvisionAuthError),
        (503, b"", HikvisionBusyError),
        (429, b"", HikvisionBusyError),
        (404, b"", HikvisionUnsupportedError),
        (500, b"", HikvisionDeviceError),
        (200, b'{"statusCode":2}', HikvisionBusyError),
        (200, b'{"statusCode":6}', HikvisionDeviceError),
        (200, b'{"unrelated":"OK"}', HikvisionDeviceError),
    ],
)
async def test_unlock_requires_real_acknowledgement(status, body, error):
    handler = AsyncMock(return_value=httpx.Response(status, content=body))
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        client = HikvisionClient(session, SETTINGS, enabled_doors=frozenset({1}))
        with pytest.raises(error):
            await client.async_unlock(1)
    handler.assert_awaited_once()


@pytest.mark.parametrize(
    ("transport_error", "expected"),
    [(httpx.ReadTimeout, HikvisionTimeoutError), (httpx.ConnectError, HikvisionConnectionError)],
)
async def test_transport_errors_do_not_expose_url_or_retry(transport_error, expected):
    handler = AsyncMock(side_effect=transport_error("demo-secret private URL"))
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        client = HikvisionClient(session, SETTINGS, enabled_doors=frozenset({1}))
        with pytest.raises(expected) as err:
            await client.async_unlock(1)
        assert "demo-secret" not in str(err.value)
    handler.assert_awaited_once()


async def test_digest_nonce_not_reused_between_requests():
    seen = []

    def handler(request):
        seen.append(request.headers.get("Authorization"))
        if "Authorization" not in request.headers:
            return httpx.Response(
                401, headers={"WWW-Authenticate": 'Digest realm="test", nonce="nonce", qop="auth"'}
            )
        return httpx.Response(200, json={"CallStatus": {"status": "idle"}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        client = HikvisionClient(session, SETTINGS)
        await client.async_call_status()
        await client.async_call_status()
    assert seen[0] is None and seen[2] is None
    assert "nc=00000001" in seen[1] and "nc=00000001" in seen[3]


async def test_snapshot_coalesced_and_does_not_cache_error():
    handler = AsyncMock(
        side_effect=[
            httpx.Response(200, content=b"broken"),
            httpx.Response(200, content=b"\xff\xd8image\xff\xd9"),
        ]
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        client = HikvisionClient(session, SETTINGS)
        with pytest.raises(HikvisionValidationError):
            await client.async_snapshot()
        results = await asyncio.gather(*(client.async_snapshot() for _ in range(6)))
    assert results == [b"\xff\xd8image\xff\xd9"] * 6
    assert handler.await_count == 2


async def test_optional_malformed_capabilities_never_enable_features():
    def handler(request):
        if request.url.path.endswith("deviceInfo"):
            return httpx.Response(200, json=INFO)
        if request.url.path.endswith("callStatus"):
            return httpx.Response(200, json={"CallStatus": {"status": "idle"}})
        return httpx.Response(
            200,
            json={
                "CallStatus": {"status": None},
                "RemoteControlDoor": {"doorNo": {}, "cmd": {"@opt": None}},
                "StreamingChannel": "invalid",
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        profile = await HikvisionClient(session, SETTINGS).async_profile()
    assert profile.unique_id == "DEMO-SERIAL"
    assert profile.api_door_ids == () and profile.call_states == ()
    assert not profile.snapshot and not profile.stream


async def test_valid_profile_and_optional_auth_failure():
    responses = [
        INFO,
        {"CallStatus": {"status": "idle"}},
        {"CallStatus": {"status": {"@opt": ["idle", "ring", "onCall"]}}},
        {
            "RemoteControlDoor": {
                "doorNo": {"@min": "1", "@max": "2"},
                "cmd": {"@opt": "open,close"},
            }
        },
        {"StreamingChannel": {"id": "101", "enabled": "true", "Video": {"enabled": "true"}}},
    ]
    handler = AsyncMock(
        side_effect=[httpx.Response(200, json=item) for item in responses]
        + [httpx.Response(200, content=b"\xff\xd8image\xff\xd9")]
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        profile = await HikvisionClient(session, SETTINGS).async_profile()
    assert profile.snapshot and profile.stream and profile.api_door_ids == (1, 2)
    assert profile.call_states == ("idle", "ring", "onCall")
    with patch.object(
        HikvisionClient,
        "_get",
        AsyncMock(
            side_effect=[INFO, {"CallStatus": {"status": "idle"}}, HikvisionAuthError("failed")]
        ),
    ):
        with pytest.raises(HikvisionAuthError):
            await HikvisionClient(None, SETTINGS).async_profile()


@pytest.mark.parametrize(
    "info",
    [
        {"DeviceInfo": {"model": "other", "serialNumber": "demo"}},
        {"DeviceInfo": {"model": "DS-KV6124-E1", "serialNumber": "", "macAddress": "garbage"}},
    ],
)
async def test_unknown_model_or_missing_identity_rejected(info):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=info))
    ) as session:
        with pytest.raises((HikvisionUnsupportedError, HikvisionValidationError)):
            await HikvisionClient(session, SETTINGS).async_device_info()


async def test_cancellation_releases_request_lock():
    started = asyncio.Event()

    async def handler(request):
        started.set()
        await asyncio.Event().wait()

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        client = HikvisionClient(session, SETTINGS)
        task = asyncio.create_task(client.async_call_status())
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert not client._io_lock.locked()


@pytest.mark.parametrize("value", [True, False, float("nan"), float("inf"), -1, 0, 1000, "2"])
def test_invalid_poll_options(value):
    from custom_components.hikvision_intercom.configuration import PollOptions

    with pytest.raises(HikvisionValidationError):
        PollOptions.from_mapping({"idle_interval": value})


async def test_address_reassigned_after_setup_cannot_release_other_station():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json=INFO)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        client = HikvisionClient(
            session, SETTINGS, enabled_doors=frozenset({1}), expected_identity="OTHER-SERIAL"
        )
        with pytest.raises(HikvisionValidationError):
            await client.async_unlock(1)
    assert len(requests) == 1 and requests[0].method == "GET"
