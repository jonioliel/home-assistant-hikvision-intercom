"""Protocol regression tests from manufacturer contracts and sanitized field evidence."""

import copy
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest

from custom_components.hikvision_intercom.client.client import ConnectionSettings, HikvisionClient
from custom_components.hikvision_intercom.client.events import EventClient, EventFrames
from custom_components.hikvision_intercom.events import EventCache, normalize_event
from custom_components.hikvision_intercom.exceptions import HikvisionValidationError

NOW = datetime(2026, 9, 8, 12, tzinfo=UTC)
KEY = b"x" * 32


def payload(minor=1, **extra):
    return {
        "eventType": "AccessControllerEvent",
        "eventState": "active",
        "dateTime": NOW.isoformat(),
        "AccessControllerEvent": {
            "majorEventType": 5,
            "subEventType": minor,
            "serialNo": 12,
            "currentEvent": True,
            **extra,
        },
    }


def normalized(data=None, **kw):
    return normalize_event(data or payload(), "station", KEY, received=NOW, selected_api=1, **kw)


def mime(body, kind=b"application/json"):
    return (
        b"--boundary\r\nContent-Type: "
        + kind
        + b"\r\nContent-Length: "
        + str(len(body)).encode()
        + b"\r\n\r\n"
        + body
        + b"\r\n"
    )


@pytest.mark.parametrize("size", [1, 2, 3, 13, 255, 1024, 65536])
def test_fragmented_mime_skips_binary_and_preserves_utf8(size):
    doc = payload(name="אור")
    wire = (
        mime(json.dumps(doc, ensure_ascii=False).encode())
        + mime(b"\xff\x00{unsafe image}", b"image/jpeg")
        + mime(b'{"eventType":"videoloss"}')
    )
    parser = EventFrames()
    rows = []
    for offset in range(0, len(wire), size):
        rows.extend(parser.feed(wire[offset : offset + size]))
    assert rows == [doc, {"eventType": "videoloss"}]
    assert not parser.remaining and not parser.body


@pytest.mark.parametrize(
    "wire",
    [
        b"x" * 8193,
        b"Content-Type: application/json\r\n\r\n{}",
        b"Content-Type: application/json\r\nContent-Length: 99999999\r\n\r\n",
        b"Content-Type: application/json\r\nContent-Length: 0\r\n\r\n",
        b"Content-Type: application/json\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\n{}",
        mime(b'<!DOCTYPE x [<!ENTITY a "secret">]><x>&a;</x>', b"application/xml"),
    ],
)
def test_bad_stream_is_bounded_and_rejected(wire):
    with pytest.raises(HikvisionValidationError):
        EventFrames().feed(wire)


@pytest.mark.parametrize(
    ("minor", "kind", "result", "auth"),
    [
        (1, "access_granted", "granted", "card"),
        (9, "access_denied", "denied", "card"),
        (148, "attempt_limit", "denied", "pin"),
        (150, "access_denied", "denied", "pin"),
        (181, "access_granted", "granted", "pin"),
        (214, "unlock_record", "unknown", "unknown"),
        (216, "door_not_closed", "unknown", "unknown"),
        (60000, "unknown", "unknown", "unknown"),
    ],
)
def test_verified_codes_not_assumed_physical_open(minor, kind, result, auth):
    row = normalized(payload(minor))
    assert (row["event_type"], row["result"], row["authentication"]) == (kind, result, auth)
    assert row["door"] is None and not row["recovered"]


def test_normalization_redacts_credentials_and_preserves_explicit_identity():
    row = normalized(
        payload(
            password="private-pin",
            pin="private-pin",
            cardNo="9876543210",
            employeeNoString="A001",
            employeeNo=9,
            doorNo=1,
            pictureURL="http://secret/image",
            name="Resident",
        )
    )
    assert row["employee_no"] == "A001" and row["card"] == "••••3210" and row["door"] == 1
    assert not any(
        secret in json.dumps(row) for secret in ["private-pin", "9876543210", "http://secret"]
    )
    assert normalized(payload(1, doorNo=2))["door"] is None
    assert normalized(payload(1, cardNo="1234"))["card"] == "••••"
    assert normalized(payload(214, unlockType=[]))["authentication"] == "unknown"


def test_major_codes_are_not_interchangeable():
    data = payload(150)
    data["AccessControllerEvent"]["majorEventType"] = 3
    assert normalized(data)["event_type"] == "unknown"
    assert normalized({"eventType": "videoloss"}) is None


@pytest.mark.parametrize(
    "alter",
    [
        {"currentEvent": False},
        {"currentEvent": None},
    ],
)
def test_historical_stream_never_fires_live(alter):
    assert normalized(payload(**alter))["recovered"]


def test_old_missing_or_future_device_time_not_live():
    for date in [
        None,
        "invalid",
        "2026-09-08T12:00:00",
        (NOW - timedelta(minutes=2)).isoformat(),
        (NOW + timedelta(minutes=2)).isoformat(),
    ]:
        data = payload()
        data["dateTime"] = date
        assert normalized(data)["recovered"]


def test_fixture_observations_match_manufacturer_meanings():
    path = Path("tests/fixtures/ds_kv6124_e1_fw_3_9_0_station_b/pin_change_rejection.json")
    capture = json.loads(path.read_text(encoding="utf-8"))["capture"]["live_events"]
    rows = [normalized(item["payload"]) for item in capture]
    assert sum(row["event_type"] == "access_denied" for row in rows) == 2
    assert sum(row["event_type"] == "attempt_limit" for row in rows) == 3


def test_query_duplicates_have_stable_distinct_occurrences():
    row = {"major": 5, "minor": 1, "time": NOW.isoformat(), "cardNo": "9876543210"}
    first = normalized(row, historical=True, occurrence=0)
    second = normalized(row, historical=True, occurrence=1)
    assert first["id"] != second["id"] and first["recovered"]
    assert first == normalized(row, historical=True, occurrence=0)


def test_cache_dedupe_persistence_bounds_and_filters():
    cache = EventCache(limit=3)
    first = normalized(payload(150, employeeNoString="42", name="Dana", doorNo=1))
    assert cache.add(first, NOW) and not cache.add(first, NOW)
    for serial in [13, 14, 15]:
        cache.add(normalized(payload(serialNo=serial)), NOW)
    assert len(cache.rows) == 3 and first["id"] not in cache.rows
    data = cache.dump()
    restored = EventCache(limit=3)
    restored.load(data, NOW)
    assert restored.dump() == data
    page = restored.query({"limit": 2}, NOW)
    assert len(page["records"]) == 2 and page["next"]
    assert len(restored.query({"before": page["next"]}, NOW)["records"]) == 1
    page["records"][0]["person_name"] = "changed"
    assert "changed" not in str(restored.dump())
    restored.prune(NOW + timedelta(days=31))
    assert not restored.rows
    cache = EventCache()
    cache.add(first, NOW)
    assert (
        len(
            cache.query(
                {
                    "person": "dANA",
                    "result": "denied",
                    "authentication": "pin",
                    "door": 1,
                    "start": (NOW - timedelta(seconds=1)).isoformat(),
                },
                NOW,
            )["records"]
        )
        == 1
    )
    assert not cache.query({"station_id": "other"}, NOW)["records"]


@pytest.mark.parametrize(
    "filters",
    [
        {"limit": True},
        {"limit": 100000},
        {"pin": "secret"},
        {"door": 2},
        {"start": "bad"},
        {"before": "missing"},
        {"result": "invented"},
    ],
)
def test_query_rejects_invalid_filters(filters):
    with pytest.raises(HikvisionValidationError):
        EventCache().query(filters, NOW)


def test_cache_rejects_private_or_corrupted_storage():
    cache = EventCache()
    cache.add(normalized(), NOW)
    data = cache.dump()
    data["records"][0]["pin"] = "private"
    with pytest.raises(HikvisionValidationError):
        EventCache().load(data, NOW)


async def test_event_search_uses_observed_pagination_and_preserves_duplicate_rows():
    requests = []
    row = {"major": 5, "minor": 1, "time": NOW.isoformat()}

    async def response(request):
        data = json.loads(request.content)["AcsEventCond"]
        requests.append(data)
        assert data["major"] == 5 and data["minor"] == 0 and data["picEnable"] is False
        position = data["searchResultPosition"]
        return httpx.Response(
            200,
            json={
                "AcsEvent": {
                    "searchID": data["searchID"],
                    "numOfMatches": 2 if position == 0 else 1,
                    "totalMatches": 3,
                    "responseStatusStrg": "MORE" if position == 0 else "OK",
                    "InfoList": [row, row] if position == 0 else [{**row, "minor": 150}],
                }
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as session:
        client = EventClient(
            HikvisionClient(session, ConnectionSettings("192.0.2.10", "demo", "secret"))
        )
        client.page_size = 2
        client.position_limit = 1000
        result = await client.async_history(NOW - timedelta(days=1), NOW)
    assert len(result) == 3 and [r["searchResultPosition"] for r in requests] == [0, 2]
    assert requests[0]["searchID"] == requests[1]["searchID"]


@pytest.fixture
def event_capability():
    return json.loads(
        Path(
            "tests/fixtures/ds_kv6124_e1_fw_3_9_0_station_b/event_search_capabilities.json"
        ).read_text(encoding="utf-8")
    )["payload"]


async def test_event_capability_uses_actual_limits(event_capability):
    fixture = event_capability
    core = AsyncMock()
    core._get.return_value = fixture
    client = EventClient(core)
    assert (
        await client.async_capabilities()
        and client.page_size == 30
        and client.position_limit == 1000
    )
    invalid = copy.deepcopy(fixture)
    invalid["AcsEvent"]["AcsEventCond"]["maxResults"]["@max"] = True
    core._get.return_value = invalid
    assert not await EventClient(core).async_capabilities()


def test_observed_nested_multipart_headers_and_extra_blank_lines():
    header = (
        b"Content-Type: multipart/form-data; boundary=MIME_boundary\r\n"
        b'--MIME_boundary\r\nContent-Disposition: form-data; name="Event"\r\n'
    )
    wire = (
        mime(b'{"eventType":"videoloss"}') + b"\r\n" + header + mime(json.dumps(payload()).encode())
    )
    parser = EventFrames()
    docs = []
    for offset in range(0, len(wire), 17):
        docs.extend(parser.feed(wire[offset : offset + 17]))
    assert len(docs) == 2 and docs[1] == payload()


def test_latest_access_uses_actual_time_not_replay_order_or_door_motion():
    cache = EventCache()
    accepted = normalized(payload(name="Resident", cardNo="000012345678", localPassword="918273"))
    accepted["timestamp"] = "2026-09-08T14:58:00+03:00"  # 11:58 UTC
    cache.add(accepted, NOW)
    denied = normalized(payload(150, serialNo=13, name="Guest"))
    denied["timestamp"] = "2026-09-08T11:59:00+00:00"
    cache.add(denied, NOW)
    old = normalized({"major": 5, "minor": 1, "time": "2026-09-08T11:30:00Z"}, historical=True)
    cache.add(old, NOW)  # A recovered record arrives after the newer denial.
    cache.add(normalized(payload(22, serialNo=14)), NOW)
    cache.add(normalized(payload(60000, serialNo=15)), NOW)
    future = normalized(payload(1, serialNo=16))
    future["timestamp"] = (NOW + timedelta(days=1)).isoformat()
    cache.add(future, NOW)
    summary = cache.latest_access({"station", "empty"}, NOW)
    assert summary["station"]["person_name"] == "Guest"
    assert summary["station"]["result"] == "denied"
    assert "empty" not in summary
    for field in ("card", "id", "major", "minor", "localPassword"):
        assert field not in summary["station"]
    page = cache.query({"end": NOW.isoformat(), "result": "granted"}, NOW)
    assert [item["id"] for item in page["records"]] == [accepted["id"], old["id"]]
    restored = EventCache()
    restored.load(cache.dump(), NOW)
    assert restored.latest_access({"station"}, NOW) == summary
    assert not restored.latest_access({"station"}, NOW + timedelta(days=31))


def test_latest_unknown_unlock_record_remains_unknown_and_marks_receipt_time():
    cache = EventCache()
    event = payload(214, unlockType="password")
    event["dateTime"] = "no device clock"
    cache.add(normalized(event), NOW)
    summary = cache.latest_access({"station"}, NOW)["station"]
    assert summary["event_type"] == "unlock_record" and summary["result"] == "unknown"
    assert summary["authentication"] == "pin" and summary["recovered"] is True
    assert summary["time_source"] == "received"


@pytest.mark.parametrize(
    "value,expected",
    [
        ("00042", "00042"),
        ("A_42", "A_42"),
        (42, "42"),
        (0, None),
        (True, None),
        (42.0, None),
        ("9" * 33, None),
    ],
)
def test_employee_identifiers_preserve_significant_zeroes(value, expected):
    assert normalized(payload(employeeNo=value))["employee_no"] == expected


def test_explicit_string_employee_field_keeps_precedence():
    assert normalized(payload(employeeNoString="00042", employeeNo=42))["employee_no"] == "00042"
    assert normalized(payload(employeeNoString="", employeeNo="00042"))["employee_no"] == "00042"
