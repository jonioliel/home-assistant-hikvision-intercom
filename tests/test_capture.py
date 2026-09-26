"""No live card collection: exact vendor contracts and administrator-owned session tests."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from test_access_engine import setup as setup  # noqa: F401
from test_access_manager import drain
from test_access_manager import fleet as fleet
from test_client import SETTINGS

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.client.capture import (
    CaptureCapabilities,
    CapturedCard,
    CardCaptureClient,
)
from custom_components.hikvision_intercom.client.client import HikvisionClient
from custom_components.hikvision_intercom.exceptions import (
    HikvisionUnsupportedError,
    HikvisionValidationError,
)

FLAGS = {"AcsCap": {"isSupportCaptureCardInfo": "true"}}
CAP = {"CardInfoCap": {"cardNo": {"@min": 1, "@max": 32}}}
NUMBER = "000055556666"
CAPTURED = CapturedCard(NUMBER, "TypeA_M1", None)


@pytest.mark.parametrize("flag", [None, False, "false", 1, "TRUE", [], {}])
def test_missing_or_ambiguous_support_does_not_enable_collection(flag):
    with pytest.raises(HikvisionUnsupportedError):
        CaptureCapabilities.parse({"isSupportCaptureCardInfo": flag}, CAP)
    with pytest.raises(HikvisionUnsupportedError):
        CaptureCapabilities.parse({"a": FLAGS, "b": FLAGS}, CAP)


def test_observed_capabilities_select_default_reader_without_inventing_reader_one():
    cap = CaptureCapabilities.parse(FLAGS, CAP)
    assert cap.readers == (0,) and cap.card_min == 1 and cap.card_max == 32
    explicit = CaptureCapabilities.parse(
        FLAGS, {"CardInfoCap": {"readerID": {"@min": 2, "@max": 3}, "cardType": ["TypeA_M1"]}}
    )
    assert explicit.readers == (2, 3) and explicit.technologies == {"TypeA_M1"}
    assert NUMBER not in repr(CAPTURED) + str(CAPTURED.public())


@pytest.mark.parametrize(
    "field,value",
    [
        ("readerID", {"@min": 0, "@max": 1}),
        ("readerID", {"@min": 1, "@max": 9}),
        ("cardNo", {"@min": True, "@max": 32}),
        ("cardNo", {"@min": 1, "@max": 33}),
        ("cardType", ["normalCard"]),
    ],
)
def test_invalid_bounds_and_access_enum_are_not_collection_capabilities(field, value):
    with pytest.raises((HikvisionUnsupportedError, HikvisionValidationError)):
        CaptureCapabilities.parse(FLAGS, {"CardInfoCap": {field: value}})


async def test_capability_false_never_calls_collect_or_detailed_capability():
    calls = []

    def handler(request):
        calls.append(request.url.path)
        return httpx.Response(200, json={"isSupportCaptureCardInfo": False})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        collector = CardCaptureClient(HikvisionClient(session, SETTINGS))
        with pytest.raises(HikvisionUnsupportedError):
            await collector.async_capabilities()
    assert calls == ["/ISAPI/AccessControl/capabilities"]


async def test_capture_default_path_and_pending_request_leave_normal_io_available():
    entered, release = asyncio.Event(), asyncio.Event()
    paths = []

    async def handler(request):
        paths.append((request.method, request.url.path, str(request.url.query)))
        if request.url.path.endswith("/CaptureCardInfo"):
            assert "readerID" not in str(request.url)
            entered.set()
            await release.wait()
            return httpx.Response(200, json={"CardInfo": {"cardNo": NUMBER}})
        return httpx.Response(200, json={"CallStatus": {"status": "idle"}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        client = HikvisionClient(session, SETTINGS)
        task = asyncio.create_task(
            CardCaptureClient(client).async_capture(CaptureCapabilities.parse(FLAGS, CAP), 0)
        )
        try:
            await asyncio.wait_for(entered.wait(), 1)
            assert (await asyncio.wait_for(client.async_call_status(), 1)).normalized == "idle"
            release.set()
            assert (await task).number == NUMBER
        finally:
            release.set()
            await asyncio.gather(task, return_exceptions=True)
    assert all(method == "GET" for method, _, _ in paths)


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"cardNo": ""},
        {"cardNo": "a" * 33},
        {"cardNo": "abcde", "readerID": 2},
        {"cardNo": "abcde", "readerID": True},
        {"cardNo": "abcde", "cardType": "normalCard"},
    ],
)
async def test_malformed_collected_values_do_not_become_a_credential(payload):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json={"CardInfo": payload})
        )
    ) as session:
        caps = CaptureCapabilities(1, 32, (1,), frozenset())
        with pytest.raises(HikvisionValidationError):
            await CardCaptureClient(HikvisionClient(session, SETTINGS)).async_capture(caps, 1)


async def test_explicit_reader_is_validated_before_network_and_echo_must_match():
    seen = []

    def handler(request):
        seen.append(request)
        assert request.url.params["readerID"] == "2"
        return httpx.Response(
            200, json={"CardInfo": {"cardNo": NUMBER, "readerID": 2, "cardType": "TypeA_M1"}}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as session:
        client = CardCaptureClient(HikvisionClient(session, SETTINGS))
        caps = CaptureCapabilities(1, 32, (2,), frozenset({"TypeA_M1"}))
        with pytest.raises(HikvisionValidationError):
            await client.async_capture(caps, 1)
        assert not seen
        assert (await client.async_capture(caps, 2)).reader_id == 2


@pytest.fixture
async def enrollment(fleet, monkeypatch):
    manager, device, _ = fleet
    collector = SimpleNamespace(
        async_capabilities=AsyncMock(return_value=CaptureCapabilities.parse(FLAGS, CAP)),
        async_capture=AsyncMock(return_value=CAPTURED),
    )
    original = manager.enrollment._client

    def client(station):
        original(station)
        return collector

    monkeypatch.setattr(manager.enrollment, "_client", client)
    user = await manager.async_create({"display_name": "Capture target"}, sync_now=False)
    return manager, device, collector, user


async def captured(enrollment, actor="admin"):
    manager, _, _, user = enrollment
    result = manager.enrollment.start("a", user["id"], user["revision"], 0, actor)
    await manager.enrollment.sessions[result["session_id"]].task
    return result["session_id"]


async def test_capture_is_ephemeral_then_explicit_confirm_saves_one_normal_card(enrollment):
    manager, device, _, user = enrollment
    key = await captured(enrollment)
    result = manager.enrollment.status(key, "admin")
    assert result["state"] == "captured" and NUMBER not in str(result)
    assert not manager.repository.get(user["id"]).cards and not device.writes
    saved = await manager.enrollment.confirm(key, "admin", "Collected")
    card = manager.repository.get(user["id"]).cards[0]
    assert card.card_no.value == NUMBER and card.card_type == "normalCard"
    assert card.label == "Collected" and NUMBER not in str(saved)
    assert not manager.enrollment.sessions
    await drain(manager)


async def test_other_administrator_cannot_read_cancel_or_confirm_capture(enrollment):
    manager, _, _, _ = enrollment
    key = await captured(enrollment)
    with pytest.raises(AccessError, match="capture_not_found"):
        manager.enrollment.status(key, "another")
    with pytest.raises(AccessError, match="capture_not_found"):
        await manager.enrollment.cancel(key, "another")
    with pytest.raises(AccessError, match="capture_not_found"):
        await manager.enrollment.confirm(key, "another", "")
    assert manager.enrollment.status(key, "admin")["state"] == "captured"


async def test_expiry_and_cancel_clear_private_card_without_saving(enrollment):
    manager, _, _, user = enrollment
    key = await captured(enrollment)
    ref = manager.enrollment.sessions[key]
    manager.enrollment._expire(key)
    assert ref.card is None and key not in manager.enrollment.sessions
    key = await captured(enrollment)
    await manager.enrollment.cancel(key, "admin")
    await manager.enrollment.cancel(key, "admin")
    assert not manager.enrollment.sessions and not manager.repository.get(user["id"]).cards


async def test_stale_revision_conflict_and_failed_store_do_not_keep_capture(
    enrollment, monkeypatch
):
    manager, _, _, user = enrollment
    key = await captured(enrollment)
    await manager.async_update(
        user["id"], {"display_name": "Changed"}, revision=user["revision"], sync_now=False
    )
    with pytest.raises(AccessError, match="revision_conflict"):
        await manager.enrollment.confirm(key, "admin", "")
    assert not manager.enrollment.sessions and not manager.repository.get(user["id"]).cards
    user["revision"] += 1
    key = await captured(enrollment)
    monkeypatch.setattr(
        manager.repository, "_save", AsyncMock(side_effect=AccessError("storage_write_failed"))
    )
    with pytest.raises(AccessError, match="storage_write_failed"):
        await manager.enrollment.confirm(key, "admin", "")
    assert not manager.enrollment.sessions and not manager.repository.get(user["id"]).cards


async def test_capture_respects_existing_credential_ownership(enrollment):
    manager, _, _, user = enrollment
    await manager.async_create(
        {"display_name": "Other owner", "cards": [{"card_no": NUMBER}]}, sync_now=False
    )
    key = await captured(enrollment)
    with pytest.raises(AccessError, match="card_conflict"):
        await manager.enrollment.confirm(key, "admin", "")
    assert not manager.repository.get(user["id"]).cards and not manager.enrollment.sessions


async def test_waiting_capture_cancelled_on_station_unload_and_no_second_session(enrollment):
    manager, _, collector, user = enrollment
    entered = asyncio.Event()

    async def wait(*args, **kwargs):
        entered.set()
        await asyncio.Future()

    collector.async_capture.side_effect = wait
    start = manager.enrollment.start("a", user["id"], user["revision"], 0, "admin")
    task = manager.enrollment.sessions[start["session_id"]].task
    await entered.wait()
    with pytest.raises(AccessError, match="capture_station_busy"):
        manager.enrollment.start("a", user["id"], user["revision"], 0, "admin")
    await manager.async_detach("a")
    assert task.cancelled() and not manager.enrollment.sessions
    assert not manager.repository.get(user["id"]).cards


async def test_unsupported_failure_is_safe_and_does_not_collect(enrollment):
    manager, _, collector, _ = enrollment
    collector.async_capabilities.side_effect = HikvisionUnsupportedError("PRIVATE_DEVICE_TEXT")
    key = await captured(enrollment)
    result = manager.enrollment.status(key, "admin")
    assert result["error"] == "capture_unsupported" and "PRIVATE" not in str(result)
    collector.async_capture.assert_not_called()


async def test_duplicate_confirm_and_cancel_cannot_interrupt_a_durable_save(
    enrollment, monkeypatch
):
    manager, _, _, user = enrollment
    key = await captured(enrollment)
    original = manager.repository._save
    entered, release = asyncio.Event(), asyncio.Event()

    async def saving(state):
        entered.set()
        await release.wait()
        await original(state)

    monkeypatch.setattr(manager.repository, "_save", saving)
    task = asyncio.create_task(manager.enrollment.confirm(key, "admin", ""))
    try:
        await entered.wait()
        with pytest.raises(AccessError, match="capture_not_ready"):
            await manager.enrollment.confirm(key, "admin", "")
        with pytest.raises(AccessError, match="capture_applying"):
            await manager.enrollment.cancel(key, "admin")
        manager.enrollment._expire(key)
        assert key in manager.enrollment.sessions
        release.set()
        await task
    finally:
        release.set()
        await asyncio.gather(task, return_exceptions=True)
    assert len(manager.repository.get(user["id"]).cards) == 1 and not manager.enrollment.sessions


async def test_session_limit_and_camera_only_stations_cannot_start(enrollment):
    manager, _, _, user = enrollment
    manager.register("camera", "Camera", False)
    manager.stations["camera"].driver = manager.stations["a"].driver
    with pytest.raises(AccessError, match="station_has_no_managed_lock"):
        manager.enrollment.start("camera", user["id"], user["revision"], 0, "admin")
    for sid in ("b", "c", "d"):
        manager.register(sid, sid, True)
        manager.stations[sid].driver = manager.stations["a"].driver
    for sid in ("a", "b", "c"):
        manager.enrollment.start(sid, user["id"], user["revision"], 0, "admin")
    with pytest.raises(AccessError, match="capture_limit"):
        manager.enrollment.start("d", user["id"], user["revision"], 0, "admin")
    await manager.async_close()
    assert not manager.enrollment.sessions
