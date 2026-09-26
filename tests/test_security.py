import json
from pathlib import Path

import httpx
import pytest

from custom_components.hikvision_intercom.client.parser import parse_payload
from custom_components.hikvision_intercom.client.probe import (
    ENDPOINTS,
    ProbeClient,
    ProbeEndpoint,
    ProbeLimits,
    validate_host,
)
from custom_components.hikvision_intercom.client.redaction import (
    REDACTED,
    safe_headers,
    safe_namespaces,
    sanitize,
)
from custom_components.hikvision_intercom.exceptions import HikvisionValidationError

FIXTURES = Path(__file__).parent / "fixtures" / "synthetic"


def test_export_removes_credentials_identity_unknown_fields_and_binary_metadata():
    raw = parse_payload((FIXTURES / "users.json").read_bytes()).data
    raw.update(parse_payload((FIXTURES / "device_info.xml").read_bytes()).data)
    raw.update(
        {
            "unknownField": "PRIVATE-FUTURE",
            "unknownNumeric": 987654321,
            "nested": {"PIN": 912345, "Authorization": "Digest private", "cookie": "private"},
        }
    )
    exported = json.dumps(sanitize(raw))
    for secret in (
        "SYNTHETIC-",
        "SYNTHETIC PERSON",
        "PRIVATE-FUTURE",
        "987654321",
        "912345",
        "00:11:22:33:44:55",
        "Digest private",
    ):
        assert secret not in exported
    assert '"doorRight": "1,2"' in exported
    assert '"numOfMatches": 1' in exported


def test_secret_capability_limits_survive_without_secret_values():
    raw = parse_payload(
        b'<Caps><password min="4" max="8">private-pin</password>'
        b'<employeeNo max="32">secret-id</employeeNo></Caps>'
    ).data
    result = sanitize(raw)
    assert result["Caps"]["password"] == {"@min": "4", "@max": "8", "#text": REDACTED}
    assert result["Caps"]["employeeNo"]["@max"] == "32"


def test_explicit_secrets_scrub_even_allowed_fields_and_keys():
    assert sanitize({"callStatus": "SECRET", "SECRET": True}, ("SECRET",)) == {
        "callStatus": REDACTED,
        "redacted_field_1": REDACTED,
    }
    assert sanitize({"private@example.com": "value"}) == {"redacted_field_0": REDACTED}


def test_header_allowlist_and_namespace_redaction():
    headers = safe_headers(
        httpx.Headers(
            {
                "Content-Type": "multipart/mixed; boundary=private",
                "Allow": "GET, POST",
                "Set-Cookie": "PRIVATE",
                "WWW-Authenticate": "PRIVATE",
                "Server": "PRIVATE",
                "Location": "http://private/",
            }
        )
    )
    assert headers == {"content-type": "multipart/mixed", "allow": "GET, POST"}
    assert safe_namespaces(["http://private/secret"]) == [REDACTED]


@pytest.mark.parametrize(
    "host", ["http://device", "user:pass@device", "device/path", "host?x=1", "host#part", ".."]
)
def test_host_rejects_urls_and_credentials(host):
    with pytest.raises(HikvisionValidationError):
        validate_host(host)


@pytest.mark.parametrize(
    ("host", "expected"),
    [("device.local", "device.local"), ("192.0.2.1", "192.0.2.1"), ("::1", "[::1]")],
)
def test_host_accepts_hostname_and_ipv4_ipv6(host, expected):
    assert validate_host(host) == expected


@pytest.mark.parametrize(
    "kwargs",
    [
        {"request_seconds": 0},
        {"request_seconds": float("nan")},
        {"stream_seconds": 31},
        {"max_bytes": 0},
        {"page_size": 51},
        {"max_pages": 21},
    ],
)
def test_unsafe_limits_rejected(kwargs):
    with pytest.raises(HikvisionValidationError):
        ProbeLimits(**kwargs)


async def test_write_endpoint_cannot_be_requested():
    requests = []
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda req: requests.append(req))
    ) as session:
        client = ProbeClient(session, host="example.test", username="admin", password="private")
        for method, path in [
            ("PUT", "/ISAPI/AccessControl/RemoteControl/door/1"),
            ("POST", "/ISAPI/AccessControl/UserInfo/Record?format=json"),
            ("GET", "https://other.example/path"),
        ]:
            with pytest.raises(HikvisionValidationError):
                await client.probe(ProbeEndpoint("forbidden", path, method))
    assert requests == []


def test_allowlist_contains_only_safe_search_posts_and_gets():
    assert all(
        e.method == "GET" or (e.method == "POST" and e.search_root and "/Search?" in e.path)
        for e in ENDPOINTS
    )
    assert all("/door/" not in e.path for e in ENDPOINTS)
