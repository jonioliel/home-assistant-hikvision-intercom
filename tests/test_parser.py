import json
from pathlib import Path

import pytest

from custom_components.hikvision_intercom.client.parser import (
    check_response_status,
    find_values,
    parse_payload,
)
from custom_components.hikvision_intercom.exceptions import (
    HikvisionAuthError,
    HikvisionBusyError,
    HikvisionCapacityError,
    HikvisionConflictError,
    HikvisionDeviceError,
    HikvisionUnsupportedError,
    HikvisionValidationError,
)

FIXTURES = Path(__file__).parent / "fixtures" / "synthetic"


def test_xml_namespace_and_identity():
    parsed = parse_payload((FIXTURES / "device_info.xml").read_bytes())
    assert parsed.namespaces == ["http://www.isapi.org/ver20/XMLSchema"]
    assert find_values(parsed.data, "model") == ["DS-KV6124-E1"]


def test_json_structure_and_repeated_xml_nodes():
    parsed = parse_payload((FIXTURES / "users.json").read_bytes())
    assert find_values(parsed.data, "numOfMatches") == [1]
    xml = parse_payload(
        b'<Caps><doorNo>1</doorNo><doorNo>2</doorNo><password min="4" max="8"/></Caps>'
    )
    assert xml.data["Caps"]["doorNo"] == ["1", "2"]
    assert xml.data["Caps"]["password"] == {"@min": "4", "@max": "8"}


@pytest.mark.parametrize(
    "body",
    [
        b"",
        b"not-json",
        b"{broken",
        b"[]",
        b"\xff",
        b"<unclosed>",
        b'<!DOCTYPE x [<!ENTITY secret "secret">]><x>&secret;</x>',
        b'<!DOCTYPE x SYSTEM "file:///etc/passwd"><x/>',
    ],
)
def test_malformed_and_entity_payloads_rejected(body):
    with pytest.raises(HikvisionValidationError) as caught:
        parse_payload(body)
    assert "passwd" not in str(caught.value)
    assert "secret" not in str(caught.value)


@pytest.mark.parametrize(
    ("subcode", "error"),
    [
        ("notSupport", HikvisionUnsupportedError),
        ("noPermission", HikvisionAuthError),
        ("cardNoAlreadyExist", HikvisionConflictError),
        ("userFull", HikvisionCapacityError),
        ("deviceCardFull", HikvisionCapacityError),
        ("deviceUserFull", HikvisionCapacityError),
        ("cardFullPerUser", HikvisionCapacityError),
        ("deviceUserAlreadyExist", HikvisionConflictError),
        ("userPasswordAlreadyExist", HikvisionConflictError),
        ("unknownFutureCode", HikvisionDeviceError),
    ],
)
@pytest.mark.parametrize("xml", [True, False])
def test_response_status_error_even_if_http_would_be_200(subcode, error, xml):
    body = (
        (
            f"<ResponseStatus><statusCode>6</statusCode><subStatusCode>{subcode}</subStatusCode>"
            "<statusString>SYNTHETIC-PRIVATE-ERROR</statusString></ResponseStatus>"
        ).encode()
        if xml
        else json.dumps(
            {"statusCode": 6, "subStatusCode": subcode, "statusString": "SYNTHETIC-PRIVATE-ERROR"}
        ).encode()
    )
    with pytest.raises(error) as caught:
        check_response_status(parse_payload(body).data)
    assert "PRIVATE" not in str(caught.value)


def test_success_code_and_missing_status_are_not_errors():
    check_response_status({"ResponseStatus": {"statusCode": "1"}})
    check_response_status({"CallStatus": {"callStatus": "future_state"}})


def test_deep_response_rejected_before_recursive_export():
    data = {}
    for _ in range(60):
        data = {"nested": data}
    with pytest.raises(HikvisionValidationError, match="traversal"):
        parse_payload(json.dumps(data).encode())


@pytest.mark.parametrize("code", [2, "2"])
def test_manufacturer_device_busy_is_distinct_without_echoing_body(code):
    with pytest.raises(HikvisionBusyError) as caught:
        check_response_status({"statusCode": code, "errorMsg": "PRIVATE-PIN-AND-IDENTITY"})
    assert str(caught.value) == "Device is busy"
