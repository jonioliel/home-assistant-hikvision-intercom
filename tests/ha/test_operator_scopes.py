"""Enforce operator station and field scopes at real HA transport boundaries."""

import asyncio
import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest

from custom_components.hikvision_intercom.access_runtime import get_manager
from custom_components.hikvision_intercom.client.capture import CaptureCapabilities, CapturedCard
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.event_manager import get_events
from custom_components.hikvision_intercom.events import normalize_event
from custom_components.hikvision_intercom.panel_permissions import AREAS, FIELDS

from . import test_audio, test_profiles_rtc, test_tts_audio
from .test_audio import started
from .test_events import live
from .test_fleet_alerts import query as query_alerts
from .test_fleet_alerts import suppress
from .test_profiles_rtc import OFFER
from .test_tts_audio import start_tts
from .test_websocket import request

# Reuse mocked device and loopback provider fixtures; all authorization is real HA.
audio_driver = test_audio.audio_driver
rtc_server = test_profiles_rtc.rtc_server
tts_player = test_tts_audio.tts_player


async def grant(hass, user, station_ids, **field_levels):
    permissions = hass.data[DOMAIN]["panel_permissions"]
    policy = {
        "enabled": True,
        "areas": dict.fromkeys(AREAS, "manage"),
        "station_ids": station_ids,
        "fields": {field: field_levels.get(field, "manage") for field in FIELDS},
    }
    await permissions.update(permissions.revision, {user.id: policy}, [user.id])


async def people(hass, station):
    manager = get_manager(hass)
    manager.register("outside", "Outside station", True)
    users = []
    for name, assignments in (
        ("Local", {station: {"allowed_locks": [1]}}),
        ("Shared", {station: {"allowed_locks": [1]}, "outside": {"allowed_locks": [1]}}),
        ("Outside", {"outside": {"allowed_locks": [1]}}),
    ):
        users.append(
            await manager.repository.async_create(
                {"display_name": name, "phone": "0501234567", "assignments": assignments}
            )
        )
    return users


@pytest.mark.parametrize(
    "filters",
    [
        {"credential": "pin"},
        {"credential": "no_card"},
        {"profile": {"dept": "Private"}},
        {"group": "private-group"},
        {"rights": "assigned"},
        {"state": "expired"},
        {"state": "upcoming"},
    ],
)
async def test_directory_hidden_field_filters_are_denied_but_view_only_filters_work(
    hass, loaded_entry, hass_ws_client, hass_read_only_user, hass_read_only_access_token, filters
):
    await people(hass, loaded_entry.entry_id)
    await grant(hass, hass_read_only_user, [loaded_entry.entry_id], **dict.fromkeys(FIELDS, "none"))
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    denied = await request(
        reader, "users/query", query="", filters=filters, offset=0, limit=25, snapshot=""
    )
    assert denied["error"]["code"] == "field_access_denied"
    await grant(hass, hass_read_only_user, [loaded_entry.entry_id], **dict.fromkeys(FIELDS, "view"))
    allowed = await request(
        reader, "users/query", query="", filters=filters, offset=0, limit=25, snapshot=""
    )
    assert allowed["success"], allowed
    assert "outside" not in json.dumps(allowed)


async def test_admin_scope_settings_and_projected_directory(
    hass, loaded_entry, hass_ws_client, hass_read_only_user, hass_read_only_access_token
):
    local, shared, outside = await people(hass, loaded_entry.entry_id)
    await grant(hass, hass_read_only_user, [loaded_entry.entry_id], phone="none")
    admin = await hass_ws_client(hass)
    settings = (await request(admin, "authorization/settings_get"))["result"]
    assert set(settings["fields"]) == set(FIELDS)
    assert {item["id"] for item in settings["stations"]} == {loaded_entry.entry_id, "outside"}
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    overview = (await request(reader, "overview"))["result"]
    assert [item["id"] for item in overview["stations"]] == [loaded_entry.entry_id]
    assert {item["id"] for item in overview["users"]} == {local.id, shared.id}
    assert overview["user_count"] == 2
    assert "users/csv_export" not in overview["api"]["commands"]
    assert "outside" not in json.dumps(overview)
    users = (await request(reader, "users/list"))["result"]
    assert all(item["phone"] == "" for item in users)
    assert next(item for item in users if item["id"] == shared.id)["operator_editable"] is False
    hidden = await request(reader, "users/get", user_id=outside.id)
    assert hidden["error"]["code"] == "unauthorized"
    query = await request(
        reader, "users/query", query="0501234567", filters={}, offset=0, limit=25, snapshot=""
    )
    assert query["result"]["total"] == 0
    assert query["result"]["total_all"] == 2


@pytest.mark.parametrize(
    "command",
    [
        "users/csv_export",
        "sync/all",
        "audit/list",
        "users/adopt",
        "whatsapp/history",
        "users/bulk_preview",
        "clock/settings_update",
        "clock/host_apply",
    ],
)
async def test_restricted_global_commands_fail_before_payload_or_device_io(
    hass,
    loaded_entry,
    hass_ws_client,
    hass_read_only_user,
    hass_read_only_access_token,
    device_io,
    command,
):
    await grant(hass, hass_read_only_user, [loaded_entry.entry_id])
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    denied = await request(reader, command)
    assert denied["error"]["code"] == "unauthorized"
    device_io["unlock"].assert_not_called()
    device_io["write_person"].assert_not_called()


@pytest.mark.parametrize(
    "command",
    [
        "stations/get",
        "stations/test_unlock",
        "sync/station",
        "stations/technical_get",
        "clock/station_sync",
    ],
)
async def test_forged_station_id_cannot_bypass_scope(
    hass,
    loaded_entry,
    hass_ws_client,
    hass_read_only_user,
    hass_read_only_access_token,
    device_io,
    command,
):
    await grant(hass, hass_read_only_user, [loaded_entry.entry_id])
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    data = {"station_id": "outside"}
    if command == "stations/test_unlock":
        data["lock"] = 1
    if command == "clock/station_sync":
        data.update(revision=0, copy_system=True)
    result = await request(reader, command, **data)
    assert result["error"]["code"] == "unauthorized"
    device_io["unlock"].assert_not_called()
    device_io["write_person"].assert_not_called()


async def test_person_edit_preserves_read_only_fields_and_rejects_shared_identity(
    hass, loaded_entry, hass_ws_client, hass_read_only_user, hass_read_only_access_token
):
    local, shared, _ = await people(hass, loaded_entry.entry_id)
    await grant(hass, hass_read_only_user, [loaded_entry.entry_id], phone="view")
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    denied = await request(
        reader,
        "users/update",
        user_id=local.id,
        revision=local.revision,
        data={"phone": ""},
        sync_now=False,
    )
    assert denied["error"]["code"] == "field_access_denied"
    denied = await request(
        reader,
        "users/update",
        user_id=shared.id,
        revision=shared.revision,
        data={"display_name": "Changed"},
        sync_now=False,
    )
    assert denied["error"]["code"] == "person_scope_shared"
    denied = await request(
        reader,
        "users/update",
        user_id=local.id,
        revision=local.revision,
        data={"assignments": {"outside": {"allowed_locks": [1]}}},
        sync_now=False,
    )
    assert denied["error"]["code"] == "unauthorized"
    changed = await request(
        reader,
        "users/update",
        user_id=local.id,
        revision=local.revision,
        data={"display_name": "Renamed"},
        sync_now=False,
    )
    assert changed["success"], changed
    assert changed["result"]["display_name"] == "Renamed"
    assert changed["result"]["phone"] == "050-123-4567"
    assert get_manager(hass).repository.get(local.id).phone == "050-123-4567"


@pytest.mark.parametrize(
    ("data", "error"),
    [
        ({"display_name": "Unassigned"}, "operator_scope_required"),
        (
            {"display_name": "Outside", "assignments": {"outside": {"allowed_locks": [1]}}},
            "unauthorized",
        ),
        ({"display_name": "Hidden contact", "phone": "0501234567"}, "field_access_denied"),
    ],
)
async def test_scoped_creation_cannot_make_an_outside_or_hidden_field_grant(
    hass,
    loaded_entry,
    hass_ws_client,
    hass_read_only_user,
    hass_read_only_access_token,
    data,
    error,
):
    await grant(hass, hass_read_only_user, [loaded_entry.entry_id], phone="none")
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    result = await request(reader, "users/create", data=data, sync_now=False)
    assert result["error"]["code"] == error
    assert not get_manager(hass).repository.users()


async def test_scoped_creation_is_visible_and_respects_permission_snapshot_changes(
    hass, loaded_entry, hass_ws_client, hass_read_only_user, hass_read_only_access_token
):
    await grant(hass, hass_read_only_user, [loaded_entry.entry_id], phone="none")
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    created = await request(
        reader,
        "users/create",
        sync_now=False,
        data={
            "display_name": "Scoped new person",
            "assignments": {loaded_entry.entry_id: {"allowed_locks": [1]}},
        },
    )
    assert created["success"], created
    assert created["result"]["operator_editable"]
    page = (
        await request(reader, "users/query", query="", filters={}, offset=0, limit=25, snapshot="")
    )["result"]
    assert page["total"] == 1
    await grant(hass, hass_read_only_user, [loaded_entry.entry_id], phone="view")
    refreshed = (
        await request(
            reader,
            "users/query",
            query="",
            filters={},
            offset=0,
            limit=25,
            snapshot=page["snapshot"],
        )
    )["result"]
    assert refreshed["stale"] and refreshed["snapshot"] != page["snapshot"]


async def test_hidden_credentials_redacted_before_event_pagination_and_export(
    hass, loaded_entry, hass_ws_client, hass_read_only_user, hass_read_only_access_token
):
    await grant(
        hass, hass_read_only_user, [loaded_entry.entry_id], credentials="none", photo="none"
    )
    monitor = loaded_entry.runtime_data.events
    monitor.ingest(live(cardNo="9876543210", name="Allowed person", serialNo=800))
    events = get_events(hass)
    outside = normalize_event(
        live(name="Outside secret", serialNo=801),
        "outside",
        b"x" * 32,
        received=datetime.now(UTC),
        selected_api=1,
    )
    assert events.cache.add(outside, datetime.now(UTC))
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    result = (await request(reader, "events/list", filters={"limit": 1}))["result"]
    assert len(result["records"]) == 1
    assert result["records"][0]["card"] is None and result["records"][0]["portrait"] is None
    for command in ("events/report", "events/print", "events/export"):
        reply = await request(reader, command, filters={})
        assert reply["success"], reply
        assert reply["result"]["totals"]["records"] == 1
        assert "Outside secret" not in json.dumps(reply)
        assert "3210" not in json.dumps(reply)
    denied = await request(reader, "events/list", filters={"station": "outside"})
    assert denied["error"]["code"] == "unauthorized"


@pytest.mark.parametrize("route", ["mse", "rtc"])
async def test_media_http_scope_denied_before_lookup(
    hass, loaded_entry, hass_client, hass_read_only_user, hass_read_only_access_token, route
):
    await grant(hass, hass_read_only_user, ["other"])
    client = await hass_client(hass)
    reply = await client.get(
        f"/api/{DOMAIN}/{route}/{loaded_entry.entry_id}",
        headers={"Authorization": f"Bearer {hass_read_only_access_token}"},
    )
    assert reply.status == 403


async def test_station_scope_revocation_closes_live_rtc(
    hass, loaded_entry, hass_client, hass_read_only_user, hass_read_only_access_token, rtc_server
):
    await grant(hass, hass_read_only_user, [loaded_entry.entry_id])
    client = await hass_client(hass)
    ws = await client.ws_connect(
        f"/api/{DOMAIN}/rtc/{loaded_entry.entry_id}",
        headers={"Authorization": f"Bearer {hass_read_only_access_token}"},
    )
    await ws.send_json({"offer": OFFER})
    assert (await ws.receive_json())["type"] == "answer"
    await ws.receive_json()
    await grant(hass, hass_read_only_user, [])
    event = await asyncio.wait_for(ws.receive_json(), 3)
    assert event["type"] == "error"
    await ws.close()
    await asyncio.wait_for(rtc_server["closed"].wait(), 3)


async def test_station_scope_revocation_ends_audio_and_invalidates_token(
    hass,
    loaded_entry,
    hass_ws_client,
    hass_read_only_user,
    hass_read_only_access_token,
    audio_driver,
):
    await grant(hass, hass_read_only_user, [loaded_entry.entry_id])
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    _, token = await started(reader, loaded_entry.entry_id)
    await grant(hass, hass_read_only_user, [])
    closed = await asyncio.wait_for(reader.receive_json(), 3)
    assert closed["event"]["state"] == "closed"
    await hass.async_block_till_done()
    audio_driver.close.assert_awaited_once()
    assert not hass.data[DOMAIN]["audio_sessions"]
    denied = await request(reader, "audio/receive", token=token)
    assert not denied["success"]


async def test_tts_scope_denial_does_not_synthesize_or_touch_device(
    hass, loaded_entry, hass_ws_client, hass_read_only_user, hass_read_only_access_token, tts_player
):
    await grant(hass, hass_read_only_user, ["other"])
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    denied = await start_tts(reader, loaded_entry.entry_id)
    assert denied["error"]["code"] == "unauthorized"
    tts_player[0].start.assert_not_called()
    tts_player[1].assert_not_called()


async def start_capture(reader, station, person):
    return await request(
        reader,
        "cards/capture_start",
        station_id=station,
        user_id=person.id,
        revision=person.revision,
        reader_id=0,
    )


@pytest.fixture
def card_collector():
    with (
        patch(
            "custom_components.hikvision_intercom.client.capture.CardCaptureClient.async_capabilities",
            AsyncMock(return_value=CaptureCapabilities(1, 32, (0,), frozenset())),
        ) as caps,
        patch(
            "custom_components.hikvision_intercom.client.capture.CardCaptureClient.async_capture",
            AsyncMock(return_value=CapturedCard("000012347788", "TypeA_M1", None)),
        ) as collect,
    ):
        yield caps, collect


async def test_scoped_operator_collects_and_explicitly_saves_card_for_local_person(
    hass,
    loaded_entry,
    hass_ws_client,
    hass_read_only_user,
    hass_read_only_access_token,
    card_collector,
):
    local, shared, _ = await people(hass, loaded_entry.entry_id)
    await grant(hass, hass_read_only_user, [loaded_entry.entry_id], phone="none")
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    denied = await start_capture(reader, loaded_entry.entry_id, shared)
    assert denied["error"]["code"] == "person_scope_shared"
    card_collector[0].assert_not_called()
    started = await start_capture(reader, loaded_entry.entry_id, local)
    assert started["success"], started
    key = started["result"]["session_id"]
    await hass.async_block_till_done()
    state = await request(reader, "cards/capture_status", session_id=key)
    assert state["result"]["state"] == "captured"
    assert not get_manager(hass).repository.get(local.id).cards
    saved = await request(reader, "cards/capture_confirm", session_id=key, label="Collected")
    assert saved["success"] and saved["result"]["phone"] == ""
    assert "000012347788" not in json.dumps([started, state, saved])
    assert get_manager(hass).repository.get(local.id).cards[0].card_no.value == "000012347788"
    assert not get_manager(hass).enrollment.sessions


@pytest.mark.parametrize("change", ["credentials", "station", "shared_person"])
async def test_capture_is_discarded_when_current_scope_or_person_assignment_changes(
    hass,
    loaded_entry,
    hass_ws_client,
    hass_read_only_user,
    hass_read_only_access_token,
    card_collector,
    monkeypatch,
    change,
):
    manager = get_manager(hass)
    local, _, _ = await people(hass, loaded_entry.entry_id)
    await grant(hass, hass_read_only_user, [loaded_entry.entry_id])
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    started = await start_capture(reader, loaded_entry.entry_id, local)
    key = started["result"]["session_id"]
    await hass.async_block_till_done()
    ref = manager.enrollment.sessions[key]
    assert ref.card is not None
    dropped = asyncio.Event()
    original_drop = manager.enrollment._drop

    def notice_drop(session):
        task = original_drop(session)
        if session.id == key:
            dropped.set()
        return task

    monkeypatch.setattr(manager.enrollment, "_drop", notice_drop)
    if change == "credentials":
        await grant(hass, hass_read_only_user, [loaded_entry.entry_id], credentials="view")
    elif change == "station":
        await grant(hass, hass_read_only_user, [])
    else:
        await manager.repository.async_update(
            local.id,
            {
                "assignments": {
                    loaded_entry.entry_id: {"allowed_locks": [1]},
                    "outside": {"allowed_locks": [1]},
                }
            },
            expected_revision=local.revision,
        )
    # No client polling is needed for server-side removal of the private card.
    await asyncio.wait_for(dropped.wait(), 3)
    assert ref.card is None and not manager.repository.get(local.id).cards
    denied = await request(reader, "cards/capture_confirm", session_id=key, label="")
    assert not denied["success"]


async def test_card_capture_does_not_allow_another_operator_to_take_session(
    hass,
    loaded_entry,
    hass_ws_client,
    hass_read_only_user,
    hass_read_only_access_token,
    card_collector,
):
    local, _, _ = await people(hass, loaded_entry.entry_id)
    await grant(hass, hass_read_only_user, [loaded_entry.entry_id])
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    started = await start_capture(reader, loaded_entry.entry_id, local)
    key = started["result"]["session_id"]
    await hass.async_block_till_done()
    admin = await hass_ws_client(hass)
    for command, fields in (
        ("cards/capture_status", {}),
        ("cards/capture_cancel", {}),
        ("cards/capture_confirm", {"label": ""}),
    ):
        reply = await request(admin, command, session_id=key, **fields)
        assert reply["error"]["code"] == "capture_not_found"
    assert (await request(reader, "cards/capture_cancel", session_id=key))["success"]


async def test_credential_viewer_cannot_start_card_collection(
    hass,
    loaded_entry,
    hass_ws_client,
    hass_read_only_user,
    hass_read_only_access_token,
    card_collector,
):
    local, _, _ = await people(hass, loaded_entry.entry_id)
    await grant(hass, hass_read_only_user, [loaded_entry.entry_id], credentials="view")
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    denied = await start_capture(reader, loaded_entry.entry_id, local)
    assert denied["error"]["code"] == "unauthorized"
    card_collector[0].assert_not_called()
    card_collector[1].assert_not_called()


async def test_fleet_alerts_scope_applies_before_counts_paging_and_maintenance_lists(
    hass,
    loaded_entry,
    hass_ws_client,
    hass_read_only_user,
    hass_read_only_access_token,
    device_io,
):
    manager = get_manager(hass)
    manager.register("outside", "Outside station", True)
    loaded_entry.runtime_data.coordinator.last_update_success = False
    admin = await hass_ws_client(hass)
    assert (await suppress(admin, "outside"))["success"]
    assert (await suppress(admin, loaded_entry.entry_id, revision=1))["success"]
    await grant(hass, hass_read_only_user, [loaded_entry.entry_id], phone="none")
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    report = await query_alerts(reader)
    assert report["success"], report
    result = report["result"]
    assert result["total"] == 1 and result["active_count"] == 0
    assert result["suppressed_count"] == 1 and len(result["suppressions"]) == 1
    assert result["items"][0]["station_id"] == loaded_entry.entry_id
    assert "outside" not in json.dumps(result)
    denied = await request(
        reader,
        "fleet/alerts",
        offset=0,
        limit=1,
        station_id="outside",
        kind="",
        include_suppressed=True,
    )
    assert denied["error"]["code"] == "unauthorized"
    denied = await suppress(reader, "outside", revision=2)
    assert denied["error"]["code"] == "unauthorized"
    restored = await request(
        reader,
        "fleet/alerts_action",
        revision=2,
        station_id=loaded_entry.entry_id,
        kind="maintenance",
        action="restore",
        duration_minutes=60,
        reason="planned_maintenance",
    )
    assert restored["success"]
    again = (await query_alerts(reader))["result"]
    assert again["total"] == 1 and again["active_count"] == 1 and not again["suppressions"]
    assert len((await query_alerts(admin))["result"]["suppressions"]) == 1
    device_io["unlock"].assert_not_called()
    device_io["write_person"].assert_not_called()


async def test_outside_binding_after_assignment_removal_is_read_only_in_every_person_view(
    hass, loaded_entry, hass_ws_client, hass_read_only_user, hass_read_only_access_token
):
    manager = get_manager(hass)
    local, _, _ = await people(hass, loaded_entry.entry_id)
    await manager.repository.async_bind("outside", local.id, fingerprint="previously-observed")
    await grant(hass, hass_read_only_user, [loaded_entry.entry_id])
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    for command, data in (
        ("users/get", {"user_id": local.id}),
        ("users/list", {}),
        ("users/query", {"query": "", "filters": {}, "offset": 0, "limit": 25, "snapshot": ""}),
        ("overview", {}),
    ):
        response = await request(reader, command, **data)
        assert response["success"], response
        reply = response["result"]
        rows = (
            [reply]
            if command == "users/get"
            else reply
            if command == "users/list"
            else reply["records"]
            if command == "users/query"
            else reply["users"]
        )
        assert next(row for row in rows if row["id"] == local.id)["operator_editable"] is False
        assert "outside" not in json.dumps(reply)
    denied = await request(
        reader,
        "users/update",
        user_id=local.id,
        revision=manager.repository.get(local.id).revision,
        data={"display_name": "Change before removal completed"},
        sync_now=False,
    )
    assert denied["error"]["code"] == "person_scope_shared"


async def test_scoped_clock_operator_uses_saved_ntp_without_global_configuration_rights(
    hass, loaded_entry, hass_ws_client, hass_read_only_user, hass_read_only_access_token
):
    await grant(hass, hass_read_only_user, [loaded_entry.entry_id])
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    policy = (await request(reader, "clock/settings_get"))["result"]
    with patch(
        "custom_components.hikvision_intercom.clock_api.synchronize",
        AsyncMock(return_value={"clock_verified": True, "configuration_verified": True}),
    ) as sync:
        allowed = await request(
            reader,
            "clock/station_sync",
            station_id=loaded_entry.entry_id,
            revision=policy["revision"],
            copy_system=True,
        )
        assert allowed["success"], allowed
        sync.assert_awaited_once()
        assert sync.await_args.args[1] == {
            key: policy[key] for key in ("server", "port", "interval")
        }
        denied = await request(
            reader,
            "clock/station_sync",
            station_id="outside",
            revision=policy["revision"],
            copy_system=False,
        )
        assert denied["error"]["code"] == "unauthorized"
        sync.assert_awaited_once()


@pytest.mark.parametrize(
    "command", ["events/list", "events/report", "events/export", "events/print"]
)
async def test_event_group_filters_use_the_scoped_catalog_in_every_output(
    hass, loaded_entry, hass_ws_client, hass_read_only_user, hass_read_only_access_token, command
):
    await grant(hass, hass_read_only_user, [loaded_entry.entry_id])
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    admin = await hass_ws_client(hass)
    profiles = {
        "fields": [],
        "groups": [
            {"id": "local-group", "station_ids": [loaded_entry.entry_id]},
            {"id": "outside-group", "station_ids": ["outside"]},
            {"id": "shared-group", "station_ids": [loaded_entry.entry_id, "outside"]},
        ],
    }
    with patch.object(hass.data[DOMAIN]["profile_settings"], "public", return_value=profiles):
        for identifier in ("outside-group", "shared-group", "unknown-group"):
            denied = await request(reader, command, filters={"current_group": identifier})
            assert denied["error"]["code"] == "invalid_fields", denied
        allowed = await request(reader, command, filters={"current_group": "local-group"})
        assert allowed["success"], allowed
        unrestricted = await request(admin, command, filters={"current_group": "shared-group"})
        assert unrestricted["success"], unrestricted
