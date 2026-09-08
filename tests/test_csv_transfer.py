"""CSV batches preserve atomic desired state and credential ownership."""

import asyncio
import csv
import io
from unittest.mock import AsyncMock

import pytest
from test_access_engine import setup as setup  # noqa: F401
from test_access_manager import drain  # noqa: F401
from test_access_manager import fleet as fleet

from custom_components.hikvision_intercom.access.csv_transfer import (
    MAX_CSV_ROWS,
    csv_text,
    parse_csv,
)
from custom_components.hikvision_intercom.access.models import AccessError


def content(rows, headers=("employee_no", "display_name", "pin", "cards", "stations")):
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(headers)
    writer.writerows(rows)
    return output.getvalue()


async def test_batch_preview_is_private_read_only_then_persists_once_before_queue(fleet):
    manager, device, _ = fleet
    manager.register("b", "Offline", True)
    raw = content(
        [
            ["1001", "אור", "987654", '["000011112222"]', '{"Front":true,"b":true}'],
            ["1002", "Second", "", "", ""],
        ]
    )
    before = manager.repository.snapshot()
    preview = manager.preview_csv(raw, "create")
    assert not preview["errors"] and preview["counts"] == {"create": 2, "update": 0, "unchanged": 0}
    assert "987654" not in str(preview) and "000011112222" not in str(preview)
    assert manager.repository.snapshot() == before and not device.writes
    save = manager.repository._save
    save.reset_mock()
    result = await manager.async_import_csv(raw, "create", review_token=preview["review_token"])
    assert result["saved"] == 2 and save.await_count == 1
    await drain(manager)
    assert device.users["1001"]["localPassword"] == "987654"
    user = next(u for u in manager.repository.users() if u.employee_no == "1001")
    assert user.assignments["b"].sync_state == "pending"
    assert manager.stations["b"].status == "offline"


async def test_invalid_row_blocks_entire_batch_and_does_not_echo_secret(fleet):
    manager, device, _ = fleet
    raw = content([["1001", "Good", "", "", ""], ["1002", "Bad", "PRIVATEPIN", "", ""]])
    preview = manager.preview_csv(raw, "create")
    assert preview["errors"] == [{"line": 3, "code": "invalid_pin"}]
    assert preview["review_token"] is None and "PRIVATEPIN" not in str(preview)
    with pytest.raises(AccessError, match="csv_validation_failed"):
        await manager.async_import_csv(raw, "create", review_token="anything")
    assert not manager.repository.users() and not device.writes


@pytest.mark.parametrize("kind", ["pin", "cards", "employee_no"])
async def test_batch_internal_collisions_block_all_rows(fleet, kind):
    manager, _, _ = fleet
    rows = [["1001", "First", "", "", ""], ["1002", "Second", "", "", ""]]
    index = {"pin": 2, "cards": 3, "employee_no": 0}[kind]
    rows[0][index] = rows[1][index] = {
        "pin": "123456",
        "cards": '["00112233"]',
        "employee_no": "1001",
    }[kind]
    preview = manager.preview_csv(content(rows), "create")
    assert preview["errors"] and preview["review_token"] is None
    assert not manager.repository.users()


async def test_update_preserves_omitted_credentials_and_exact_card_metadata(fleet):
    manager, _, _ = fleet
    user = await manager.async_create(
        {
            "employee_no": "1001",
            "display_name": "Before",
            "pin": "987654",
            "cards": [{"card_no": "000011112222", "label": "Primary", "enabled": False}],
        },
        sync_now=False,
    )
    raw = content([["1001", "After"]], ("employee_no", "display_name"))
    assert manager.preview_csv(raw, "create")["errors"]
    preview = manager.preview_csv(raw, "upsert")
    assert preview["rows"][0]["changed_fields"] == ["display_name"]
    await manager.async_import_csv(raw, "upsert", review_token=preview["review_token"])
    changed = manager.repository.get(user["id"])
    assert (
        changed.pin.value == "987654"
        and changed.cards[0].label == "Primary"
        and not changed.cards[0].enabled
    )
    assert changed.cards[0].id == user["cards"][0]["id"]


async def test_clear_credentials_keeps_offline_retirement_reservations(fleet):
    manager, device, _ = fleet
    user = await manager.async_create(
        {
            "employee_no": "1001",
            "display_name": "Resident",
            "pin": "987654",
            "cards": [{"card_no": "000011112222"}],
            "assignments": {"a": {"allowed_locks": [1]}},
        }
    )
    await drain(manager)
    device.offline = True
    raw = content([["1001", "Resident", "CLEAR", "[]", "{}"]])
    preview = manager.preview_csv(raw, "upsert")
    assert preview["rows"][0]["access_removed"]
    await manager.async_import_csv(raw, "upsert", review_token=preview["review_token"])
    await drain(manager)
    state = manager.repository.snapshot()
    assert state["retired_pins"] and state["retired_cards"]
    assert not manager.repository.get(user["id"]).assignments


async def test_changed_central_revision_or_file_requires_new_preview(fleet):
    manager, _, _ = fleet
    user = await manager.async_create(
        {"employee_no": "1001", "display_name": "Before"}, sync_now=False
    )
    raw = content([["1001", "After"]], ("employee_no", "display_name"))
    preview = manager.preview_csv(raw, "upsert")
    with pytest.raises(AccessError, match="csv_review_stale"):
        await manager.async_import_csv(
            raw.replace("After", "Different"), "upsert", review_token=preview["review_token"]
        )
    await manager.async_update(
        user["id"], {"display_name": "Concurrent"}, revision=1, sync_now=False
    )
    with pytest.raises(AccessError, match="csv_review_stale"):
        await manager.async_import_csv(raw, "upsert", review_token=preview["review_token"])
    assert manager.repository.get(user["id"]).display_name == "Concurrent"


async def test_atomic_stamp_rejects_edit_while_batch_waits_for_storage_lock(fleet):
    manager, _, _ = fleet
    raw = content([["1001", "First"]], ("employee_no", "display_name"))
    preview = manager.preview_csv(raw, "create")
    await manager.repository._lock.acquire()
    task = asyncio.create_task(
        manager.async_import_csv(raw, "create", review_token=preview["review_token"])
    )
    for _ in range(1000):
        if manager.repository._lock._waiters:
            break
        await asyncio.sleep(0.001)
    assert manager.repository._lock._waiters
    # Simulate a preceding transaction publishing before it releases the same lock.
    manager.repository._state["tombstones"]["concurrent"] = {}
    manager.repository._lock.release()
    try:
        with pytest.raises(AccessError, match="csv_review_stale"):
            await task
    finally:
        manager.repository._state["tombstones"].pop("concurrent")
    assert not manager.repository.users()


async def test_storage_failure_has_no_partial_import_or_queue(fleet):
    manager, device, _ = fleet
    raw = content([["1001", "First"], ["1002", "Second"]], ("employee_no", "display_name"))
    preview = manager.preview_csv(raw, "create")
    manager.repository._save = AsyncMock(side_effect=AccessError("storage_write_failed"))
    manager.request_user = AsyncMock()
    with pytest.raises(AccessError, match="storage_write_failed"):
        await manager.async_import_csv(raw, "create", review_token=preview["review_token"])
    assert not manager.repository.users() and not device.writes
    manager.request_user.assert_not_called()


async def test_export_has_no_credentials_and_roundtrip_is_noop(fleet):
    manager, _, _ = fleet
    user = await manager.async_create(
        {
            "employee_no": "1001",
            "display_name": "Hebrew עברית",
            "pin": "987654",
            "cards": [{"card_no": "000011112222"}],
        },
        sync_now=False,
    )
    report = manager.export_csv()
    assert "987654" not in report["csv"] and "000011112222" not in report["csv"]
    preview = manager.preview_csv(report["csv"], "upsert")
    assert preview["counts"]["unchanged"] == 1 and not preview["errors"]
    manager.repository._save.reset_mock()
    result = await manager.async_import_csv(
        report["csv"], "upsert", review_token=preview["review_token"]
    )
    assert result["saved"] == 0 and manager.repository.get(user["id"]).revision == 1
    manager.repository._save.assert_not_called()


@pytest.mark.parametrize(
    "raw,code",
    [
        ("employee_no,display_name,unknown\n1,A,B", "csv_invalid_headers"),
        ("employee_no,display_name,display_name\n1,A,B", "csv_invalid_headers"),
        ("employee_no,display_name\n1,A,extra", "csv_invalid_columns"),
        ("employee_no,display_name\n", "csv_empty"),
        ("employee_no,display_name\n1,\ufffd", "csv_invalid_encoding"),
        ("employee_no,display_name\n1,\x00", "csv_invalid_encoding"),
        ('employee_no,display_name\n1,"unterminated', "csv_invalid_format"),
    ],
)
def test_strict_csv_shape(raw, code):
    with pytest.raises(AccessError, match=code):
        parse_csv(raw)


async def test_duplicate_json_station_names_and_camera_only_are_rejected(fleet):
    manager, _, _ = fleet
    manager.register("b", "Front", True)
    for mapping in ['{"Front":true}', '{"a":true,"a":false}', '{"a":true,"Front":true}']:
        assert manager.preview_csv(content([["1001", "Test", "", "", mapping]]), "create")["errors"]
    manager.register("c", "Camera", False)
    assert (
        manager.preview_csv(content([["1001", "Test", "", "", '{"c":true}']]), "create")["errors"][
            0
        ]["code"]
        == "station_has_no_managed_lock"
    )


async def test_limits_and_explicit_utc_validity(fleet):
    manager, _, _ = fleet
    raw = content(
        [[str(i), "Test"] for i in range(MAX_CSV_ROWS + 1)], ("employee_no", "display_name")
    )
    with pytest.raises(AccessError, match="csv_too_many_rows"):
        manager.preview_csv(raw, "create")
    with pytest.raises(AccessError, match="csv_too_large"):
        manager.preview_csv("x" * 262145, "create")
    raw = content(
        [["1001", "Timed", "2027-01-01T00:00:00", "2027-02-01T00:00:00"]],
        ("employee_no", "display_name", "valid_from", "valid_until"),
    )
    assert manager.preview_csv(raw, "create")["errors"][0]["code"] == "invalid_validity"


def test_csv_export_neutralizes_formulas_and_quotes_newlines():
    raw = csv_text(["name"], [["=1+1"], [" \t@evil"], ["+cmd"], ["-cmd"], ['line\n"quoted"']])
    rows = list(csv.reader(io.StringIO(raw.removeprefix("\ufeff"))))
    assert all(row[0].startswith("'") for row in rows[1:5])
    assert rows[5][0] == 'line\n"quoted"'


async def test_large_batch_coalesces_once_per_station_and_preserves_all_rows(fleet):
    from unittest.mock import Mock

    manager, _, _ = fleet
    for i in range(1, 9):
        manager.register(f"s{i}", f"Station {i}", True)
    targets = '{"a":true,' + ",".join(f'"s{i}":true' for i in range(1, 9)) + "}"
    raw = content([[str(1000 + i), f"Resident {i}", "", "", targets] for i in range(500)])
    preview = manager.preview_csv(raw, "create")
    assert not preview["errors"] and preview["counts"]["create"] == 500
    manager.request = Mock()
    await manager.async_import_csv(raw, "create", review_token=preview["review_token"])
    assert len(manager.repository.users()) == 500
    assert manager.request.call_count == 9


async def test_cancelled_bulk_preparation_never_saves_or_overwrites_later_edit(fleet, monkeypatch):
    from threading import Event

    manager, device, _ = fleet
    repository = manager.repository
    entered, release, finished = Event(), Event(), Event()
    original = repository._bulk_users

    def preparing(state, changes):
        entered.set()
        try:
            assert release.wait(5)
            return original(state, changes)
        finally:
            finished.set()

    monkeypatch.setattr(repository, "_bulk_users", preparing)
    repository._save.reset_mock()
    task = asyncio.create_task(
        repository.async_bulk_apply(
            [
                {
                    "user_id": None,
                    "revision": None,
                    "data": {"employee_no": "1001", "display_name": "Cancelled"},
                }
            ],
            stamp=repository.bulk_stamp(),
            validate=lambda user: None,
        )
    )
    try:
        assert await asyncio.to_thread(entered.wait, 5)
        # Reaching this coroutine while preparation is paused also proves the loop is free.
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, 1)
        repository._save.assert_not_awaited()
        assert not repository.users()
        await manager.async_create(
            {"employee_no": "1002", "display_name": "Later edit"}, sync_now=False
        )
    finally:
        release.set()
        assert await asyncio.to_thread(finished.wait, 5)
    assert [u.employee_no for u in repository.users()] == ["1002"]
    assert repository._save.await_count == 1 and not device.writes


async def test_preview_binds_station_configuration_and_async_export_is_private(fleet):
    manager, _, _ = fleet
    raw = content(
        [["1001", "Disabled", "false", '{"a":false}']],
        ("employee_no", "display_name", "active", "stations"),
    )
    preview = await manager.async_preview_csv(raw, "create")
    manager.stations["a"].lock_enabled = False
    with pytest.raises(AccessError, match="csv_review_stale"):
        await manager.async_import_csv(raw, "create", review_token=preview["review_token"])
    assert not manager.repository.users()
    await manager.async_create(
        {
            "employee_no": "1002",
            "display_name": "Kept private",
            "pin": "987654",
            "cards": [{"card_no": "000011112222"}],
        },
        sync_now=False,
    )
    exported = await manager.async_export_csv()
    assert exported["count"] == 1
    assert "987654" not in exported["csv"] and "000011112222" not in exported["csv"]
