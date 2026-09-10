"""Bulk changes preserve atomicity, credentials, replay receipts and offline work."""

import asyncio
import json
from copy import deepcopy
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.access.admin_audit import audit_actor, export, query
from custom_components.hikvision_intercom.access.bulk_operations import selection
from custom_components.hikvision_intercom.access.manager import AccessManager
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.repository import AccessRepository


@pytest.fixture
async def batch():
    repo = AccessRepository(AsyncMock())
    await repo.async_load(None)
    manager = AccessManager(repo)
    manager.register("a", "Gate", True)
    manager.register("b", "Lobby", True)
    for index in range(2):
        with audit_actor("administrator", "users/create"):
            await repo.async_create(
                {
                    "display_name": f"Resident {index}",
                    "employee_no": str(101 + index),
                    "pin": str(726310 + index),
                    "cards": [{"card_no": str(92003852 + index)}],
                    "assignments": {"a": {"allowed_locks": [1]}},
                }
            )
    yield manager
    await manager.async_close()


def request(manager, action, **extra):
    return {
        "action": action,
        "selection": [
            {"user_id": u.id, "revision": u.revision} for u in manager.repository.users()
        ],
        **extra,
    }


@pytest.mark.parametrize(
    "action",
    ["enable", "disable", "assign", "unassign", "delete", "remove_pin", "remove_cards", "sync"],
)
async def test_preview_is_readonly_and_apply_matches_review(batch, action):
    repo = batch.repository
    before = repo.snapshot()
    args = (
        {"station_id": "b" if action == "assign" else "a"}
        if action in {"assign", "unassign"}
        else {}
    )
    preview = await batch.bulk.preview("administrator", request(batch, action, **args))
    assert repo.snapshot() == before and preview["device_writes"] == 0
    assert all(
        c["source"] == "unavailable" and c["users_projected"] is None for c in preview["capacity"]
    )
    encoded = json.dumps(preview)
    assert "726310" not in encoded and "92003852" not in encoded
    result = await batch.bulk.apply("administrator", preview["operation_id"])
    assert result["changed"] == (0 if action in {"enable", "sync"} else 2)
    saved = repo.snapshot()
    repeated = await batch.bulk.apply("administrator", preview["operation_id"])
    assert result == repeated and repo.snapshot() == saved
    if action == "delete":
        assert not repo.users() and len(saved["tombstones"]) == 2
    else:
        for user in repo.users():
            assert user.active == (action != "disable")
            assert (user.pin is None) == (action == "remove_pin")
            assert (not user.cards) == (action == "remove_cards")
            assert ("a" in user.assignments) == (action != "unassign")
            assert ("b" in user.assignments) == (action == "assign")
    if action == "remove_pin":
        assert len(saved["retired_pins"]) == 2
    if action == "remove_cards":
        assert len(saved["retired_cards"]) == 2
    restored = AccessRepository(AsyncMock())
    await restored.async_load(saved)
    resumed = AccessManager(restored)
    resumed.register("a", "Gate", True)
    assert await resumed.bulk.apply("administrator", preview["operation_id"]) == result
    assert resumed.stations["a"].pending
    await resumed.async_close()


async def test_bulk_failure_is_atomic_including_receipt_and_audit(batch):
    preview = await batch.bulk.preview("administrator", request(batch, "delete"))
    before = batch.repository.snapshot()
    batch.repository._save.side_effect = OSError("disk unavailable")
    with pytest.raises(OSError):
        await batch.bulk.apply("administrator", preview["operation_id"])
    assert batch.repository.snapshot() == before
    assert not batch.stations["a"].pending


async def test_changed_user_or_station_rules_requires_new_review(batch):
    preview = await batch.bulk.preview("administrator", request(batch, "disable"))
    user = batch.repository.users()[0]
    await batch.repository.async_update(
        user.id, {"display_name": "Updated"}, expected_revision=user.revision
    )
    with pytest.raises(AccessError, match="bulk_review_stale"):
        await batch.bulk.apply("administrator", preview["operation_id"])
    preview = await batch.bulk.preview("administrator", request(batch, "assign", station_id="b"))
    batch.register("b", "Lobby", False)
    with pytest.raises(AccessError, match="bulk_review_stale"):
        await batch.bulk.apply("administrator", preview["operation_id"])


async def test_expiry_ownership_and_duplicate_apply(batch):
    preview = await batch.bulk.preview("administrator", request(batch, "disable"))
    with pytest.raises(AccessError, match="bulk_review_expired"):
        await batch.bulk.apply("another", preview["operation_id"])
    results = await asyncio.gather(
        *(batch.bulk.apply("administrator", preview["operation_id"]) for _ in range(2))
    )
    assert results[0] == results[1]
    assert all(user.revision == 2 for user in batch.repository.users())
    with pytest.raises(AccessError, match="operation_not_found"):
        batch.bulk.receipt("another", preview["operation_id"])
    preview = await batch.bulk.preview("administrator", request(batch, "enable"))
    batch.bulk.reviews[preview["operation_id"]]["deadline"] = 0
    with pytest.raises(AccessError, match="bulk_review_expired"):
        await batch.bulk.apply("administrator", preview["operation_id"])


@pytest.mark.parametrize(
    "value",
    [
        {},
        {"action": "delete", "selection": []},
        {"action": "delete", "selection": [{"user_id": "x", "revision": True}]},
        {"action": "assign", "selection": [{"user_id": "x", "revision": 1}]},
        {"action": "remove_pin", "selection": [{"user_id": "x", "revision": 1}], "pin": "SECRET"},
        {"action": "delete", "selection": [{"user_id": "x", "revision": 1}] * 2},
    ],
)
def test_bulk_selection_is_explicit_and_rejects_unknown_fields(value):
    with pytest.raises(AccessError):
        selection(value)


async def test_audit_is_atomic_masked_and_has_stable_cursor(batch):
    repo = batch.repository
    initial = query(repo.snapshot()["admin_audit"], {"limit": 1})
    assert initial["next_cursor"] is not None
    user = repo.users()[0]
    with audit_actor("administrator", "cards/remove"):
        await repo.async_update(user.id, {"cards": []}, expected_revision=user.revision)
    audit = repo.snapshot()["admin_audit"]
    page = query(audit, {"limit": 1, "before": initial["next_cursor"]})
    assert page["records"][0]["sequence"] < initial["records"][0]["sequence"]
    changes = query(audit, {"action": "cards/remove", "user_id": user.id, "station_id": "a"})
    assert changes["total"] == 1
    assert changes["records"][0]["fields"] == ["cards"]
    report = export(audit, {})
    assert "726310" not in json.dumps(report) and "92003852" not in json.dumps(report)
    assert report["records"][0]["actor"] == "administrator"
    assert report["records"][0]["before"]["card_count"] == 1
    assert report["records"][0]["after"]["card_count"] == 0


async def test_background_child_does_not_inherit_admin_attribution(batch):
    repo = batch.repository
    user = repo.users()[0]
    with audit_actor("administrator", "users/update"):
        await asyncio.create_task(
            repo.async_update(user.id, {"display_name": "Background"}, expected_revision=1)
        )
    latest = query(repo.snapshot()["admin_audit"], {})["records"][0]
    assert latest["actor"] == "" and latest["action"] == "system"


async def test_schema_two_migrates_without_inventing_past_audit(batch):
    state = batch.repository.snapshot()
    state["schema"] = 2
    state.pop("profile_settings")
    del state["admin_audit"]
    del state["operation_receipts"]
    saver = AsyncMock()
    restored = AccessRepository(saver)
    await restored.async_load(state)
    assert restored.snapshot()["schema"] == 6
    assert restored.snapshot()["admin_audit"] == {"next": 1, "records": []}
    assert restored.get(batch.repository.users()[0].id).pin == batch.repository.users()[0].pin
    assert saver.await_count == 1


async def test_corrupt_audit_cannot_be_silently_dropped(batch):
    state = deepcopy(batch.repository.snapshot())
    state["admin_audit"]["records"][0]["before"] = {"pin": "SECRET"}
    restored = AccessRepository(AsyncMock())
    with pytest.raises(AccessError):
        await restored.async_load(state)
    restored._save.assert_not_called()


async def test_preview_cache_is_bounded_per_actor(batch):
    for _ in range(12):
        await batch.bulk.preview("administrator", request(batch, "disable"))
    assert len(batch.bulk.reviews) == 5


async def test_existing_tombstones_are_not_logged_again_by_another_delete(batch):
    repo = batch.repository
    first, second = repo.users()
    await repo.async_delete(first.id, expected_revision=1)
    before = repo.snapshot()["admin_audit"]["next"]
    with audit_actor("administrator", "users/delete_unmanaged"):
        await repo.async_delete(second.id, expected_revision=1)
    records = repo.snapshot()["admin_audit"]["records"]
    assert len([row for row in records if row["sequence"] >= before]) == 1
    assert records[-1]["user_id"] == second.id


async def test_audit_retention_and_formula_safe_export(batch, monkeypatch):
    from custom_components.hikvision_intercom.access import admin_audit

    monkeypatch.setattr(admin_audit, "LIMIT", 3)
    user = batch.repository.users()[0]
    for name in ("One", "Two", "=SUM(1,2)"):
        with audit_actor("administrator", "users/update"):
            user = await batch.repository.async_update(
                user.id, {"display_name": name}, expected_revision=user.revision
            )
    audit = batch.repository.snapshot()["admin_audit"]
    assert len(audit["records"]) == 3
    assert "'=SUM(1,2)" in export(audit, {})["csv"]
    old = deepcopy(audit)
    old["records"][0]["time"] = "2000-01-01T00:00:00+00:00"
    assert query(old, {})["total"] == 2


async def test_disabled_empty_lock_assignment_roundtrips_in_audit(batch):
    user = batch.repository.users()[0]
    await batch.repository.async_update(
        user.id,
        {"assignments": {"a": {"enabled": False, "allowed_locks": []}}},
        expected_revision=1,
    )
    restored = AccessRepository(AsyncMock())
    await restored.async_load(batch.repository.snapshot())
    assert not restored.get(user.id).assignments["a"].enabled


async def test_saving_cancellation_retains_exactly_one_operation(batch):
    preview = await batch.bulk.preview("administrator", request(batch, "disable"))
    started, release = asyncio.Event(), asyncio.Event()

    async def save(_state):
        started.set()
        await release.wait()

    batch.repository._save = save
    task = asyncio.create_task(batch.bulk.apply("administrator", preview["operation_id"]))
    await started.wait()
    task.cancel()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert all(u.revision == 2 for u in batch.repository.users())
    assert batch.stations["a"].pending
    result = await batch.bulk.apply("administrator", preview["operation_id"])
    assert result["changed"] == 2 and all(u.revision == 2 for u in batch.repository.users())
    assert batch.stations["a"].pending


@pytest.mark.parametrize("action,projected,peak", [("remove_cards", 1, 2), ("enable", 3, 3)])
async def test_capacity_uses_cached_card_records_and_preserves_unselected(
    batch, action, projected, peak
):
    from dataclasses import replace

    from test_access_engine import CAP

    from custom_components.hikvision_intercom.client.access import StationInventory

    first, second = batch.repository.users()
    batch.stations["a"].inventory = StationInventory(
        users={first.employee_no: {"employeeNo": first.employee_no}},
        cards={
            first.cards[0].card_no.value: {
                "cardNo": first.cards[0].card_no.value,
                "employeeNo": first.employee_no,
            },
            "99998888": {"cardNo": "99998888", "employeeNo": "external"},
        },
    )
    batch.stations["a"].scanned_at = "2026-09-09T10:00:00+00:00"
    rules = batch._csv_rules()
    rules["a"] = ("Gate", True, 1, replace(CAP, max_cards=2))
    batch._csv_rules = lambda: rules
    before = batch.repository.snapshot()
    preview = await batch.bulk.preview("administrator", request(batch, action))
    estimate = preview["capacity"][0]
    assert estimate["source"] == "cached_inventory"
    assert estimate["checked_at"] == batch.stations["a"].scanned_at
    assert estimate["cards_now"] == 2
    assert estimate["cards_projected"] == projected and estimate["cards_peak"] == peak
    assert estimate["capacity_warning"] == (action == "enable")
    assert estimate["users_projected"] == 2
    assert batch.repository.snapshot() == before
    assert first.cards[0].card_no.value not in json.dumps(preview)
    assert second.cards[0].card_no.value not in json.dumps(preview)
