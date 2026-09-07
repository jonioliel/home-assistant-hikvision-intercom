import asyncio
import hashlib
import json
import re
import time
from pathlib import Path

import httpx
import pytest

from custom_components.hikvision_intercom.client.probe import (
    ENDPOINTS,
    ProbeClient,
    ProbeLimits,
    build_capabilities,
)
from custom_components.hikvision_intercom.client.transport import LimitedTransport
from custom_components.hikvision_intercom.models import CapabilityReport, ProbeRecord
from tools.probe_ds_kv6124 import capture_calls

FIXTURES = Path(__file__).parent / "fixtures" / "synthetic"


def response(status=200, *, data=None, body=None, headers=None):
    payload = body if body is not None else json.dumps(data or {}).encode()
    return httpx.Response(
        status,
        stream=httpx.ByteStream(payload),
        headers=headers or {"content-type": "application/json"},
    )


def client_for(session, **kwargs):
    return ProbeClient(
        session, host="station.example", username="probe-user", password="probe-secret", **kwargs
    )


def endpoint(name):
    return next(item for item in ENDPOINTS if item.name == name)


async def test_digest_challenge_and_response_hash(caplog):
    requests = []

    def handler(request):
        requests.append(request)
        if len(requests) == 1:
            assert "authorization" not in request.headers
            return response(
                401,
                headers={
                    "WWW-Authenticate": 'Digest realm="synthetic", nonce="nonce", '
                    'algorithm=MD5, qop="auth"'
                },
            )
        auth = request.headers["authorization"]
        assert auth.startswith("Digest ")
        fields = dict(re.findall(r'(\w+)="([^"]*)"', auth))
        nc = re.search(r"nc=([0-9a-f]+)", auth).group(1)

        def md5(value):
            return hashlib.md5(value.encode(), usedforsecurity=False).hexdigest()

        ha1 = md5("probe-user:synthetic:probe-secret")
        ha2 = md5(f"GET:{fields['uri']}")
        assert fields["response"] == md5(f"{ha1}:nonce:{nc}:{fields['cnonce']}:auth:{ha2}")
        assert "probe-secret" not in auth
        return response(body=(FIXTURES / "device_info.xml").read_bytes())

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        record = await client_for(session).probe(endpoint("device_info"))
    assert record.outcome == "observed"
    assert len(requests) == 2
    assert "probe-secret" not in caplog.text
    assert "SYNTHETIC-SERIAL" not in json.dumps(record.payload)


@pytest.mark.parametrize(
    ("status", "error", "outcome"),
    [
        (401, "HikvisionAuthError", "error"),
        (403, "HikvisionAuthError", "error"),
        (404, "HikvisionDeviceError", "error"),
        (405, "HikvisionUnsupportedError", "unsupported"),
        (501, "HikvisionUnsupportedError", "unsupported"),
        (500, "HikvisionDeviceError", "error"),
    ],
)
async def test_http_errors_normalized(status, error, outcome):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: response(status))
    ) as session:
        result = await client_for(session).probe(endpoint("call_status"))
    assert result.error == error
    assert result.outcome == outcome


async def test_http_200_device_failure_and_metadata():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: response(
                data={
                    "statusCode": 6,
                    "subStatusCode": "notSupport",
                    "statusString": "PRIVATE ERROR",
                },
                headers={
                    "Content-Type": "application/json",
                    "Allow": "GET",
                    "Set-Cookie": "PRIVATE",
                },
            )
        )
    ) as session:
        record = await client_for(session).probe(endpoint("call_status"))
    assert record.outcome == "unsupported"
    assert record.headers == {"content-type": "application/json", "allow": "GET"}
    assert "PRIVATE" not in json.dumps(record.payload)


async def test_redirect_not_followed():
    calls = []

    def handler(request):
        calls.append(request)
        return response(302, headers={"Location": "https://other.example/secret"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        record = await client_for(session).probe(endpoint("device_info"))
    assert len(calls) == 1
    assert record.error == "HikvisionDeviceError"
    assert record.headers == {}


@pytest.mark.parametrize(
    ("exception", "expected"),
    [
        (httpx.ConnectError, "HikvisionConnectionError"),
        (httpx.ReadTimeout, "HikvisionTimeoutError"),
    ],
)
async def test_transport_exceptions_hide_raw_message(exception, expected):
    def handler(_):
        raise exception("http://probe-user:probe-secret@station.example/private")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        result = await client_for(session).probe(endpoint("device_info"))
    assert result.error == expected
    assert "probe-secret" not in str(result)


class StallingStream(httpx.AsyncByteStream):
    def __init__(self, initial=b""):
        self.initial = initial
        self.closed = False

    async def __aiter__(self):
        yield self.initial
        await asyncio.sleep(10)

    async def aclose(self):
        self.closed = True


@pytest.mark.parametrize("event", [False, True])
async def test_stream_deadline_and_cleanup(event):
    stream = StallingStream(
        b"--boundary\r\n<EventNotificationAlert><eventType>synthetic_event</eventType>"
        b"</EventNotificationAlert>"
        if event
        else b"heartbeat"
    )
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, stream=stream))
    ) as session:
        started = time.monotonic()
        result = await client_for(session, limits=ProbeLimits(stream_seconds=0.03)).probe(
            endpoint("alert_stream")
        )
    assert time.monotonic() - started < 1
    assert stream.closed
    assert result.outcome == ("observed" if event else "no_complete_event")


async def test_ordinary_request_total_deadline():
    stream = StallingStream(b"{")
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, stream=stream))
    ) as session:
        result = await client_for(session, limits=ProbeLimits(request_seconds=0.03)).probe(
            endpoint("device_info")
        )
    assert result.error == "HikvisionTimeoutError"
    assert stream.closed


async def test_size_bound_and_no_partial_export():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: response(body=b"x" * 2048))
    ) as session:
        result = await client_for(session, limits=ProbeLimits(max_bytes=256)).probe(
            endpoint("device_info")
        )
    assert result.truncated
    assert result.bytes_received == 256
    assert result.payload is None


async def test_digest_challenge_body_also_bounded():
    transport = LimitedTransport(
        httpx.MockTransport(
            lambda _: response(
                401,
                body=b"x" * 2048,
                headers={"WWW-Authenticate": 'Digest realm="synthetic", nonce="nonce", qop="auth"'},
            )
        ),
        256,
    )
    async with httpx.AsyncClient(transport=transport) as session:
        result = await client_for(session).probe(endpoint("device_info"))
    assert result.error == "HikvisionValidationError"


async def test_compressed_response_rejected_before_decompression():
    transport = LimitedTransport(
        httpx.MockTransport(
            lambda _: response(body=b"compressed-bomb", headers={"Content-Encoding": "gzip"})
        ),
        256,
    )
    async with httpx.AsyncClient(transport=transport) as session:
        result = await client_for(session).probe(endpoint("device_info"))
    assert result.error == "HikvisionValidationError"


async def test_cancellation_not_swallowed():
    stream = StallingStream()
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, stream=stream))
    ) as session:
        task = asyncio.create_task(client_for(session).probe(endpoint("alert_stream")))
        await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert stream.closed


async def test_pagination_without_writes_or_remote_probe():
    calls = []

    def handler(request):
        calls.append(request)
        path = request.url.path
        if path.endswith("deviceInfo"):
            return response(body=(FIXTURES / "device_info.xml").read_bytes())
        if path.endswith("UserInfo/Search"):
            condition = json.loads(request.content)["UserInfoSearchCond"]
            position = condition["searchResultPosition"]
            return response(
                data={
                    "UserInfoSearch": {
                        "numOfMatches": 1,
                        "totalMatches": 2,
                        "responseSearchStatusStrg": "MORE" if position == 0 else "OK",
                        "UserInfo": [],
                    }
                }
            )
        if path.endswith("CardInfo/Search"):
            return response(
                data={
                    "CardInfoSearch": {
                        "numOfMatches": 0,
                        "totalMatches": 0,
                        "responseSearchStatusStrg": "NO MATCH",
                    }
                }
            )
        if path.endswith("callStatus"):
            return response(data={"CallStatus": {"callStatus": "synthetic_idle"}})
        return response(404)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        report = await client_for(session, limits=ProbeLimits(page_size=1)).run()
    searches = [
        json.loads(r.content)["UserInfoSearchCond"]
        for r in calls
        if r.url.path.endswith("UserInfo/Search")
    ]
    assert [s["searchResultPosition"] for s in searches] == [0, 1]
    assert searches[0]["searchID"] == searches[1]["searchID"]
    assert all(r.method == "GET" or "/Search" in r.url.path for r in calls)
    assert all("RemoteControl" not in r.url.path for r in calls)
    assert report.identity.model == "DS-KV6124-E1"
    assert report.identity.firmware == "V3.9.0 build 260115"
    assert report.features.users is True and report.features.cards is True
    assert report.features.call_status is True
    for name in ("remote_unlock", "pin_password", "door_right", "right_plan", "rtsp"):
        assert getattr(report.features, name) is None


async def test_pagination_bounded_when_firmware_never_finishes():
    def handler(request):
        if request.method == "POST":
            return response(
                data={
                    "UserInfoSearch": {
                        "numOfMatches": 1,
                        "totalMatches": 100,
                        "responseSearchStatusStrg": "MORE",
                    }
                }
            )
        return response(404)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        report = await client_for(session, limits=ProbeLimits(max_pages=2, page_size=1)).run()
    assert len([r for r in report.records if r.name.startswith("user_search")]) == 2
    assert report.observations["user_search_page_limit_reached"] is True


async def test_auth_failure_stops_scan():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: response(401))) as session:
        report = await client_for(session).run()
    assert len(report.records) == 1
    assert report.observations["scan_stopped"] == "authentication_or_permission_failure"
    assert all(v is None or v == [] for v in report.to_dict()["features"].values())


async def test_remote_capabilities_requires_explicit_exposed_flag():
    paths = []

    def handler(request):
        paths.append(request.url.path)
        return response(404)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        report = await client_for(session).run(remote_capabilities_exposed=True)
    assert paths.count("/ISAPI/AccessControl/RemoteControl/door/capabilities") == 1
    assert report.features.remote_unlock is None
    assert report.features.remote_unlock_ids == []


@pytest.mark.parametrize(
    ("body", "media", "supported"),
    [
        (b"\xff\xd8\xffsynthetic\xff\xd9", "image/jpeg", True),
        (b'{"statusCode":1}', "image/jpeg", False),
        (b"<html>login</html>", "text/html", False),
    ],
)
async def test_snapshot_needs_image_evidence_and_never_exports_pixels(body, media, supported):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: response(body=body, headers={"Content-Type": media})
        )
    ) as session:
        record = await client_for(session).probe(endpoint("snapshot"))
    report = CapabilityReport(records=[record])
    build_capabilities(report)
    assert (report.features.snapshot is True) == supported
    assert "synthetic" not in json.dumps(report.to_dict())


def test_advertisements_and_generic_success_do_not_prove_features():
    report = CapabilityReport(
        records=[
            ProbeRecord(
                "video_capabilities",
                "GET",
                "/candidate",
                outcome="observed",
                payload={"isSupportCallStatus": True, "isSupportPIN": True},
            ),
            ProbeRecord(
                "call_status",
                "GET",
                "/candidate",
                outcome="observed",
                payload={"ResponseStatus": {"statusCode": "1"}},
            ),
        ]
    )
    build_capabilities(report)
    assert report.features.call_status is None
    assert report.features.pin_password is None


async def test_call_capture_preserves_unknown_values_and_is_bounded():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: response(data={"CallStatus": {"callStatus": "future_firmware_state"}})
        )
    ) as session:
        report = CapabilityReport()
        await capture_calls(client_for(session), report, 0.05, 0.01)
    assert report.records
    assert report.records[0].payload == {"CallStatus": {"callStatus": "future_firmware_state"}}
    assert report.observations["call_timeline"][0]["offset_seconds"] >= 0
