"""Operations isolation, reviewed effects, retention and portable signatures."""

import copy
import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.events import EventCache, normalize_event
from custom_components.hikvision_intercom.fleet_alerts import observed_alerts
from custom_components.hikvision_intercom.operations_archive import archive, verify
from custom_components.hikvision_intercom.operations_center import (
    DEFAULT_RETENTION,
    DEFAULT_THRESHOLDS,
    OperationsCenter,
    in_window,
    message_warnings,
    record,
    retention,
    signed_webhook,
    webhook_settings,
)

NOW = datetime(2026, 9, 28, 12, tzinfo=UTC)
WINDOW = {
    "enabled": False,
    "days": [0, 1],
    "start": "08:00",
    "end": "18:00",
    "timezone": "Asia/Jerusalem",
}
STATION = {
    "zone": "Lobby",
    "owner": "Facilities",
    "tags": ["public"],
    "thresholds": DEFAULT_THRESHOLDS,
    "window": WINDOW,
}
TEMPLATE = {
    "label": "Card only",
    "language": "he",
    "category": "any",
    "credential": "card",
    "body": (
        "Hello {{name}}\n{{credential_section}}\n{{access_window_section}}\n{{security_notice}}"
    ),
}


def row(index=0, at=NOW):
    return normalize_event(
        {
            "eventType": "AccessControllerEvent",
            "eventState": "active",
            "dateTime": at.isoformat(),
            "AccessControllerEvent": {
                "currentEvent": True,
                "majorEventType": 5,
                "subEventType": 1,
                "serialNo": index,
                "employeeNoString": "123",
                "cardNo": "SECRET1234",
            },
        },
        "station",
        b"x" * 32,
        received=at,
        selected_api=1,
    )


async def test_preferences_commit_only_after_successful_save_and_never_overwrite_corrupt_store():
    save = AsyncMock()
    center = OperationsCenter(save)
    await center.save_record("stations", "s1", 0, STATION, "admin")
    assert save.call_args.args[0]["stations"]["s1"]["values"]["zone"] == "Lobby"
    before = copy.deepcopy(center.data)
    save.side_effect = OSError("full")
    with pytest.raises(OSError):
        await center.save_record("stations", "s1", 1, {**STATION, "owner": "changed"}, "admin")
    assert center.data == before
    with pytest.raises(AccessError, match="storage_corrupt"):
        center.load({**before, "webhook_key": "secret"})
    assert center.data == before


async def test_actor_views_are_private_and_stale_writes_rejected():
    center = OperationsCenter(AsyncMock())
    created = await center.save_record(
        "views", "", 0, {"label": "My filter", "filters": {"result": "denied"}}, "a"
    )
    assert center.public("b")["views"] == {}
    assert created["id"] in center.public("a")["views"]
    with pytest.raises(AccessError, match="unauthorized"):
        await center.save_record("views", created["id"], 1, {"label": "Taken", "filters": {}}, "b")
    with pytest.raises(AccessError, match="record_not_found"):
        await center.delete_record("views", created["id"], 1, "b")
    with pytest.raises(AccessError, match="revision_conflict"):
        await center.save_record("stations", "s1", 0, STATION, "a")


async def test_variant_matching_is_specific_and_requires_credential_schedule_and_warning_sections():
    center = OperationsCenter(AsyncMock())
    await center.save_record("templates", "general", 0, {**TEMPLATE, "credential": "any"}, "a")
    await center.save_record("templates", "card", 1, TEMPLATE, "a")
    await center.save_record(
        "templates", "staff", 2, {**TEMPLATE, "category": "staff", "label": "Staff card"}, "a"
    )
    user = SimpleNamespace(pin=None, cards=[SimpleNamespace(enabled=True)], access_category="staff")
    assert center.variant(user, "he")["label"] == "Staff card"
    assert center.variant(user, "en") is None
    user.pin = "123456"
    assert center.variant(user, "he")["label"] == "Card only"  # the general variant
    with pytest.raises(AccessError, match="template_selection_duplicate"):
        await center.save_record("templates", "duplicate", 3, TEMPLATE, "a")
    with pytest.raises(AccessError):
        record("templates", {**TEMPLATE, "body": "Hi {{name}} {{pin}}"})


@pytest.mark.parametrize("bad", ["{{unknown}}", "{{ name ", "{{__import__}}"])
def test_template_unknown_placeholders_do_not_become_executable(bad):
    with pytest.raises(AccessError):
        record("templates", {**TEMPLATE, "body": TEMPLATE["body"] + bad})


def test_message_warnings_do_not_expose_credential_values():
    user = SimpleNamespace(phone="", pin=None, cards=[], assignments={}, active=False)
    assert set(message_warnings(user)) == {
        "phone_missing",
        "credential_missing",
        "doors_missing",
        "user_inactive",
    }


def test_reviews_are_one_use_explicit_actor_bound_and_invalidated_by_settings():
    center = OperationsCenter(AsyncMock())
    token = center.review("a", "import", {"safe": True}, "stamp")
    with pytest.raises(AccessError, match="review_expired"):
        center.consume("b", token, "import", True, "stamp")
    with pytest.raises(AccessError, match="confirmation_required"):
        center.consume("a", token, "import", False, "stamp")
    assert center.consume("a", token, "import", True, "stamp") == {"safe": True}
    with pytest.raises(AccessError):
        center.consume("a", token, "import", True, "stamp")
    token = center.review("a", "import", {}, "stamp")
    center.data["revision"] += 1
    with pytest.raises(AccessError):
        center.consume("a", token, "import", True, "stamp")


async def test_mapped_import_changes_only_preferences_and_is_reviewed():
    source = OperationsCenter(AsyncMock())
    await source.save_record("stations", "old", 0, STATION, "a")
    await source.save_record("templates", "t", 1, TEMPLATE, "a")
    exported = source.export({"old": "Lobby"})
    assert "signing_key" not in json.dumps(exported) and "webhook" not in json.dumps(exported)
    target = OperationsCenter(AsyncMock())
    review = target.import_review("b", json.dumps(exported), {"old": "new"}, {"new"})
    assert target.data["stations"] == {}
    key = target.data["signing_key"]
    await target.import_apply("b", review["review_id"], True, {"new"})
    assert target.data["stations"]["new"]["values"] == STATION
    assert target.data["signing_key"] == key
    assert target.data["webhook"]["enabled"] is False


@pytest.mark.parametrize("mapping", [{}, {"old": "absent"}, {"old": "new", "extra": "new"}])
def test_import_requires_exact_existing_station_mapping(mapping):
    center = OperationsCenter(AsyncMock())
    exported = {
        "format": "smplwise-operations",
        "version": 1,
        "stations": {"old": {"name": "Lobby", "values": STATION}},
        "templates": [],
    }
    with pytest.raises(AccessError, match="station_mapping_required"):
        center.import_review("a", json.dumps(exported), mapping, {"new"})


async def test_runtime_observations_do_not_invalidate_reviews_but_cannot_store_audio():
    center = OperationsCenter(AsyncMock())
    token = center.review("a", "retention", {"ok": True})
    await center.append(
        "observations",
        {
            "at": NOW.isoformat(),
            "station_id": "s1",
            "source": "cached_probe",
            "state": "observed",
            "rtt_ms": None,
        },
    )
    assert center.consume("a", token, "retention", True)["ok"]
    with pytest.raises(AccessError):
        await center.append("observations", {"at": NOW.isoformat(), "audio": "PCM"})


def test_retention_byte_limit_and_reduction_are_not_just_a_display_preference():
    cache = EventCache(limit=1000, days=30)
    for i in range(20):
        cache.add(row(i), NOW)
    before = copy.deepcopy(cache.dump())
    preview = copy.deepcopy(cache)
    preview.configure({"days": 30, "count": 100, "bytes": 1000}, NOW)
    assert len(preview.rows) < 20 and preview._bytes <= 1000
    assert cache.dump() == before
    cache.configure({"days": 1, "count": 100, "bytes": 262144}, NOW + timedelta(days=2))
    assert cache.dump()["records"] == [] and cache._bytes == 0


@pytest.mark.parametrize(
    "key,value",
    [
        ("days", 0),
        ("days", True),
        ("days", 366),
        ("count", 20001),
        ("bytes", 1),
        ("bytes", 40_000_000),
    ],
)
def test_retention_cannot_overflow_the_private_store(key, value):
    with pytest.raises(AccessError):
        retention({**DEFAULT_RETENTION, key: value})


def test_signed_archive_validates_safe_records_and_detects_tampering_and_wrong_issuer():
    result = archive([row(1), row(2, NOW - timedelta(days=40))], "2026-09", "aa" * 32, NOW)
    assert len(result["body"]["records"]) == 1
    serialized = json.dumps(result)
    assert "SECRET1234" not in serialized
    assert verify(serialized, result["public_key"])["issuer_trusted"] is True
    assert verify(serialized)["issuer_trusted"] is False
    result["body"]["records"][0]["result"] = "denied"
    with pytest.raises(AccessError, match="archive_invalid"):
        verify(json.dumps(result))


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com",
        "https://user:password@example.com",
        "https://example.com/?token=secret",
        "https://example.com/#secret",
        "https://example.com:3000",
        "https://example.com:bad",
    ],
)
def test_webhook_rejects_unsafe_or_secret_bearing_targets(url):
    with pytest.raises(AccessError):
        webhook_settings({"enabled": True, "url": url, "kinds": ["access_event"]})


def test_webhook_is_opt_in_canonical_signed_and_omits_personal_fields():
    center = OperationsCenter(AsyncMock())
    assert center.data["webhook"]["enabled"] is False
    payload, headers = signed_webhook(
        "aa" * 32,
        "access_event",
        {
            "station_id": "s1",
            "result": "granted",
            "pin": "SECRET",
            "phone": "SECRET",
            "person_name": "SECRET",
        },
        event_id="id",
        at=NOW.isoformat(),
    )
    assert b"SECRET" not in payload
    expected = hmac.new(
        bytes.fromhex("aa" * 32), NOW.isoformat().encode() + b"." + payload, hashlib.sha256
    ).hexdigest()
    assert headers["X-Smplwise-Signature"] == "sha256=" + expected


def test_maintenance_window_is_local_time_and_does_not_accept_invalid_days():
    assert in_window({**WINDOW, "enabled": True}, NOW)
    assert not in_window({**WINDOW, "enabled": True}, NOW + timedelta(days=2))
    with pytest.raises(AccessError):
        record("stations", {**STATION, "window": {**WINDOW, "days": [0, 0]}})


def test_station_thresholds_use_continuous_observations_and_preserve_other_stations():
    stations = [{"id": "s1", "online": False}, {"id": "s2", "online": False}]
    history = {
        sid: [{"at": (NOW - timedelta(minutes=5)).isoformat(), "online": False}]
        for sid in ("s1", "s2")
    }
    assert observed_alerts(stations, history, NOW) == []
    alerts = observed_alerts(stations, history, NOW, {"s1": {"offline": 60}})
    assert [item["station_id"] for item in alerts] == ["s1"]


async def test_legacy_operations_upgrade_preserves_all_preferences_and_keys():
    center = OperationsCenter(AsyncMock())
    await center.save_record("stations", "s1", 0, STATION, "admin")
    before = copy.deepcopy(center.data)
    legacy = copy.deepcopy(before)
    legacy.pop("door_presets")
    legacy["schema"] = 1
    restored = OperationsCenter(AsyncMock())
    restored.load(legacy)
    assert restored.data == before
    assert legacy["schema"] == 1 and "door_presets" not in legacy
    malformed = {**legacy, "door_presets": {}}
    with pytest.raises(AccessError, match="storage_corrupt"):
        restored.load(malformed)
    assert restored.data == before


async def test_saved_door_presets_are_preferences_with_atomic_save_and_revision_guard():
    save = AsyncMock()
    center = OperationsCenter(save)
    preset = {"label": "Staff door", "changes": {"openDuration": 7, "relayReverseEnabled": False}}
    created = await center.save_record("door_presets", "", 0, preset, "admin")
    assert center.public("other-admin")["door_presets"][created["id"]]["values"] == preset
    before = copy.deepcopy(center.data)
    save.side_effect = OSError("full")
    with pytest.raises(OSError):
        await center.save_record(
            "door_presets", created["id"], 1, {**preset, "label": "Edited"}, "admin"
        )
    assert center.data == before
    save.side_effect = None
    with pytest.raises(AccessError, match="revision_conflict"):
        await center.delete_record("door_presets", created["id"], 0, "admin")
    await center.delete_record("door_presets", created["id"], 1, "admin")
    assert not center.data["door_presets"]


@pytest.mark.parametrize(
    "changes",
    [
        {},
        {"pin": "123456"},
        {"unlock": True},
        {"relayReverseEnabled": "false"},
        {"openDuration": True},
        {"openDuration": 256},
        {"doorName": "line\nbreak"},
    ],
)
def test_door_presets_reject_secrets_actions_and_invalid_parameter_types(changes):
    with pytest.raises(AccessError, match="invalid_fields"):
        record("door_presets", {"label": "Preset", "changes": changes})
