"""Regressions for sanitized DS-KV6124-E1 V3.9.0 build 260115 observations."""

import json
from pathlib import Path

import httpx
import pytest

from custom_components.hikvision_intercom.client.probe import (
    ENDPOINTS,
    READ_CAPABILITIES,
    REMOTE_CAPABILITIES,
    ProbeClient,
    _stream_documents,
    build_capabilities,
)
from custom_components.hikvision_intercom.client.redaction import REDACTED, sanitize
from custom_components.hikvision_intercom.models import CapabilityReport, ProbeRecord
from tools.probe_ds_kv6124 import argument_parser

FIXTURES = Path(__file__).parent / "fixtures" / "ds_kv6124_e1_fw_3_9_0"


def fixture(name):
    return json.loads((FIXTURES / f"{name}.json").read_text())


def framed(payload, *, content_type=b"application/json", length=None):
    """Reconstruct MIME framing; this is not a byte-for-byte device capture."""
    body = json.dumps(payload).encode() if isinstance(payload, dict) else payload
    size = str(len(body) if length is None else length).encode()
    return (
        b"--synthetic-boundary\r\nContent-Type: "
        + content_type
        + b"\r\nContent-Length: "
        + size
        + b"\r\n\r\n"
        + body
        + b"\r\n--synthetic-boundary\r\n"
    )


def test_real_device_read_support_does_not_promote_advertised_writes():
    records = [ProbeRecord(**record) for record in fixture("capability_report")["records"]]
    report = CapabilityReport(records=records)
    build_capabilities(report)
    assert report.identity.model == "DS-KV6124-E1"
    assert report.identity.firmware == "V3.9.0 build 260115"
    for feature in ("users", "cards", "call_status", "work_status", "event_stream", "snapshot"):
        assert getattr(report.features, feature) is True
    for feature in ("pin_password", "door_right", "right_plan", "remote_unlock", "rtsp"):
        assert getattr(report.features, feature) is None
    assert report.features.remote_unlock_ids == []
    assert fixture("pin_mode")["payload"] == {"pwMgrMode": "local"}
    assert fixture("card_capabilities")["payload"]["CardInfo"]["numberPerPerson"] == 5


@pytest.mark.parametrize(
    "entry",
    [e for e in (*ENDPOINTS, *READ_CAPABILITIES, REMOTE_CAPABILITIES) if e.mode == "structured"],
)
async def test_normalized_real_response_readback(entry):
    name = entry.name + "_00" if entry.search_root else entry.name
    recorded = fixture(name)
    # XML fixtures are normalized JSON. Raw XML parsing is covered separately.
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                stream=httpx.ByteStream(json.dumps(recorded["payload"]).encode()),
                headers={"Content-Type": "application/json"},
            )
        )
    ) as session:
        client = ProbeClient(session, host="example.test", username="test-user", password="secret")
        result = await client.probe(entry)
    assert result.outcome == "observed"
    assert result.payload == recorded["payload"]


def test_json_events_use_content_length_despite_extra_framing():
    events = fixture("historical_alert_stream")["payload"]
    assert len(events) > 1
    body = b"".join(framed(event) + b"extra firmware framing\r\n" for event in events)
    assert _stream_documents(body) == events
    access = [
        event["AccessControllerEvent"] for event in events if "AccessControllerEvent" in event
    ]
    assert access and all(event["currentEvent"] is False for event in access)
    assert _stream_documents(
        body.replace(b"Content-Type", b"content-type").replace(b"Content-Length", b"content-length")
    )


@pytest.mark.parametrize("length", [0, -1, 1048577, "9" * 5000, "not-a-number"])
def test_invalid_mime_lengths_are_ignored_without_crashing(length):
    assert _stream_documents(framed({"eventType": "example"}, length=length)) == []


def test_partial_json_tail_is_not_an_event():
    event = {"eventType": "example", "eventState": "active"}
    incomplete = framed(event, length=999)
    assert _stream_documents(incomplete) == []
    assert _stream_documents(framed(event) + incomplete) == [event]


def test_xml_mime_truncation_does_not_fall_through_to_legacy_parser():
    xml = b"<EventNotificationAlert><eventType>example</eventType></EventNotificationAlert>"
    assert _stream_documents(framed(xml, content_type=b"application/xml", length=999)) == []
    assert _stream_documents(framed(xml, content_type=b"application/xml")) == [
        {"EventNotificationAlert": {"eventType": "example"}}
    ]
    assert _stream_documents(xml) == [{"EventNotificationAlert": {"eventType": "example"}}]


def test_generic_json_success_is_not_stream_event():
    assert _stream_documents(framed({"statusCode": 1})) == []


async def test_fresh_digest_challenge_after_stream_connection_closes():
    requests = []

    async def handler(request):
        requests.append(request)
        # Model the observed device: unsolicited cached auth is rejected without challenge.
        if len(requests) % 2:
            if "authorization" in request.headers:
                return httpx.Response(401, stream=httpx.ByteStream(b"{}"))
            return httpx.Response(
                401,
                headers={
                    "WWW-Authenticate": (
                        f'Digest realm="test", nonce="nonce-{len(requests)}", qop="auth"'
                    )
                },
                stream=httpx.ByteStream(b"{}"),
            )
        payload = (
            framed({"eventType": "example"})
            if request.url.path.endswith("alertStream")
            else b'{"CallStatus":{"status":"idle"}}'
        )
        return httpx.Response(200, stream=httpx.ByteStream(payload))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        client = ProbeClient(session, host="example.test", username="test-user", password="secret")
        for entry in (ENDPOINTS[-1], ENDPOINTS[2], ENDPOINTS[-1], ENDPOINTS[2]):
            assert (await client.probe(entry)).outcome == "observed"
    assert len(requests) == 8


@pytest.mark.parametrize("extended", [False, True])
async def test_extended_reads_are_opt_in_and_cannot_activate_relay(extended):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(404, stream=httpx.ByteStream(b"{}"))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        client = ProbeClient(session, host="example.test", username="test-user", password="secret")
        await client.run(extended=extended)
    paths = {str(request.url.raw_path, "ascii") for request in requests}
    for entry in READ_CAPABILITIES:
        assert (entry.path in paths) is extended
    assert all(request.method == "GET" or "/Search?" in str(request.url) for request in requests)
    assert not any("RemoteControl" in str(request.url) for request in requests)
    assert argument_parser().parse_args(["--extended"]).extended


def test_firmware_metadata_survives_without_exporting_credentials():
    source = {
        "CardInfoCount": {"cardNumber": 0},
        "CardInfo": {"cardNumber": 123456, "cardNo": "PRIVATE-CARD", "numberPerPerson": 5},
        "UserInfo": {"password": {"@min": 4, "@max": 8, "#text": "PRIVATE-PIN"}},
        "isSupportGetUserAvailablePw": True,
        "isSupportPrivilegePassword": "true",
        "firmwareReleasedDate": "build 260115",
        "pwMgrMode": "local",
    }
    result = sanitize(source)
    assert result["CardInfoCount"]["cardNumber"] == 0
    assert result["CardInfo"] == {"cardNumber": REDACTED, "cardNo": REDACTED, "numberPerPerson": 5}
    assert result["UserInfo"]["password"] == {"@min": 4, "@max": 8, "#text": REDACTED}
    assert result["isSupportPrivilegePassword"] == "true"
    assert result["isSupportGetUserAvailablePw"] is True
    assert result["firmwareReleasedDate"] == "build 260115"
    assert result["pwMgrMode"] == "local"
    assert "PRIVATE" not in json.dumps(result)
    assert "123456" not in json.dumps(result)
    hidden = sanitize(source, ("0", "5", "local", "true"))
    assert hidden["CardInfoCount"]["cardNumber"] == REDACTED
    assert hidden["CardInfo"]["numberPerPerson"] == REDACTED
    assert hidden["pwMgrMode"] == REDACTED
    assert hidden["isSupportPrivilegePassword"] == REDACTED
