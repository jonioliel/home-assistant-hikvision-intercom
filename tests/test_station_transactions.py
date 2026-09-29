"""Atomic station transfer, durable consent and cleanup reservations."""

import asyncio
from copy import deepcopy
from unittest.mock import AsyncMock

import pytest
from test_station_lifecycle_review import setup

from custom_components.hikvision_intercom.access import station_lifecycle_jobs as jobs
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.repository import AccessRepository


def definitions(target=True):
    return [
        {
            "id": sid,
            "identity": sid + "-identity",
            "name": sid + " station",
            "mappings": [
                {"physical_index": 1, "api_id": 1, "name": None},
                {"physical_index": 2, "api_id": 2, "name": None},
            ],
        }
        for sid in (["old", "new"] if target else ["old"])
    ]


async def plan(repo, target="new", required=False):
    return await repo.async_lifecycle_prepare(
        actor="admin",
        source="old",
        target=target,
        definitions=definitions(bool(target)),
        metadata={"source": None, "target": None},
        require_approval=required,
        stamp=repo.bulk_stamp(),
    )


async def apply(repo, row):
    return await repo.async_lifecycle_apply(
        job_id=row["id"],
        actor="admin",
        fingerprint=row["fingerprint"],
        target_locks={1, 2},
        validate_user=lambda user: None,
    )


async def test_transfer_keeps_group_origin_personal_denial_locks_credentials_and_ownership():
    repo, _, inherited, denied, personal = await setup()
    await repo.async_bind("old", inherited.id, fingerprint="owned", adopted=True)
    before = repo.snapshot()
    row = await plan(repo)
    after = await apply(repo, row)
    assert after["state"] == "applied" and after["applied_at"]
    assert repo.profile_settings()["values"]["groups"][0]["station_ids"] == ["new", "other"]
    assert repo.get(inherited.id).permission_overrides == {}
    assert repo.get(inherited.id).assignments["new"].allowed_locks == {1, 2}
    assert repo.get(denied.id).permission_overrides == {"new": "deny", "unrelated": "allow"}
    assert not repo.get(denied.id).assignments["new"].enabled
    assert repo.get(personal.id).permission_overrides == {"new": "allow"}
    assert not repo.get(personal.id).active
    assert repo.get(inherited.id).pin.value == "876543"
    assert repo.snapshot()["bindings"] == before["bindings"]
    assert "876543" not in str(jobs.public(after, "admin"))
    # Group revocation still affects inherited permissions; it did not turn into a personal grant.
    settings = repo.profile_settings()
    settings["revision"] += 1
    settings["values"]["groups"][0]["station_ids"] = ["other"]
    await repo.async_profile_settings(settings)
    assert "new" not in repo.get(inherited.id).assignments
    assert not repo.get(denied.id).assignments["new"].enabled


async def test_retirement_leaves_tombstones_and_retired_pin_reserved_until_engine_readback():
    repo, _, user, _, _ = await setup()
    await repo.async_bind("old", user.id, fingerprint="owned", adopted=True)
    await repo.async_update(user.id, {"pin": "987654"}, expected_revision=user.revision)
    await repo.async_delete(user.id, expected_revision=repo.get(user.id).revision)
    before = repo.snapshot()
    row = await plan(repo, target=None)
    await apply(repo, row)
    for kind in ("tombstones", "bindings", "retired_pins"):
        assert repo.snapshot()[kind] == before[kind]
    assert not repo.pin_available("876543")
    assert not any("old" in u.assignments for u in repo.users())


async def test_failed_save_publishes_neither_policy_nor_job_application():
    repo, save, *_ = await setup()
    row = await plan(repo)
    before = repo.snapshot()
    save.side_effect = OSError("disk unavailable")
    with pytest.raises(OSError):
        await apply(repo, row)
    assert repo.snapshot() == before
    save.side_effect = None
    after = await apply(repo, row)
    assert after["state"] == "applied"
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    assert restored.snapshot() == repo.snapshot()


async def test_duplicate_apply_after_restart_never_rekeys_again():
    repo, save, *_ = await setup()
    row = await plan(repo)
    await apply(repo, row)
    restored_save = AsyncMock()
    restored = AccessRepository(restored_save)
    await restored.async_load(repo.snapshot())
    before = restored.snapshot()
    await apply(restored, row)
    assert restored.snapshot() == before
    restored_save.assert_not_awaited()


async def test_durable_second_consent_is_bound_to_actor_plan_and_current_policy():
    repo, _, *_ = await setup()
    row = await plan(repo, required=True)
    with pytest.raises(AccessError, match="approval_required"):
        await apply(repo, row)
    with pytest.raises(AccessError, match="separate_approver_required"):
        await repo.async_lifecycle_decide(
            job_id=row["id"], actor="admin", fingerprint=row["fingerprint"], approve=True
        )
    await repo.async_lifecycle_decide(
        job_id=row["id"], actor="second", fingerprint=row["fingerprint"], approve=True
    )
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    await apply(restored, row)
    assert restored.snapshot()["station_lifecycles"][row["id"]]["approval"]["actor"] == "second"


async def test_changed_policy_and_target_overlap_block_without_partial_save():
    repo, save, user, *_ = await setup()
    row = await plan(repo)
    await repo.async_update(user.id, {"display_name": "Changed"}, expected_revision=user.revision)
    before, count = repo.snapshot(), save.await_count
    with pytest.raises(AccessError, match="bulk_review_stale"):
        await apply(repo, row)
    assert repo.snapshot() == before and save.await_count == count
    row = await plan(repo)
    await repo.async_update(
        user.id,
        {"permission_overrides": {"new": "deny"}},
        expected_revision=repo.get(user.id).revision,
    )
    row = await plan(repo)
    before = repo.snapshot()
    with pytest.raises(AccessError, match="lifecycle_blocked"):
        await apply(repo, row)
    assert repo.snapshot() == before


async def test_retiring_source_cannot_be_regranted_by_person_or_group():
    repo, _, user, *_ = await setup()
    row = await plan(repo)
    await apply(repo, row)
    before = repo.snapshot()
    with pytest.raises(AccessError, match="station_retiring"):
        await repo.async_update(
            user.id,
            {"permission_overrides": {"old": "allow"}},
            expected_revision=repo.get(user.id).revision,
        )
    assert repo.snapshot() == before
    settings = repo.profile_settings()
    settings["revision"] += 1
    settings["values"]["groups"][0]["station_ids"].append("old")
    with pytest.raises(AccessError, match="station_retiring"):
        await repo.async_profile_settings(settings)
    assert repo.snapshot() == before


async def test_native_binding_is_never_copied_or_silently_dropped():
    from test_user_timing import weekly

    repo, _, user, *_ = await setup()
    await repo.async_update(
        user.id,
        {"access_timing_policy": {"mode": "native", "schedule": weekly(), "bindings": {}}},
        expected_revision=user.revision,
    )
    row = await plan(repo)
    before = repo.snapshot()
    with pytest.raises(AccessError, match="lifecycle_blocked"):
        await apply(repo, row)
    assert repo.snapshot() == before


async def test_cancelled_caller_keeps_one_atomic_persisted_transfer():
    repo, save, *_ = await setup()
    row = await plan(repo)
    entered, finish = asyncio.Event(), asyncio.Event()

    async def persist(state):
        entered.set()
        await finish.wait()

    save.side_effect = persist
    task = asyncio.create_task(apply(repo, row))
    await entered.wait()
    task.cancel()
    finish.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    saved = save.await_args.args[0]
    assert saved == repo.snapshot()
    assert saved["station_lifecycles"][row["id"]]["state"] == "applied"
    assert saved["profile_settings"]["values"]["groups"][0]["station_ids"] == ["new", "other"]
    assert all("old" not in raw["assignments"] for raw in saved["users"].values())


async def test_corrupt_lifecycle_consent_is_not_defaulted_away():
    repo, _, *_ = await setup()
    row = await plan(repo, required=True)
    state = deepcopy(repo.snapshot())
    state["station_lifecycles"][row["id"]]["approval"] = {
        "actor": "admin",
        "approved": True,
        "fingerprint": row["fingerprint"],
    }
    save = AsyncMock()
    restored = AccessRepository(save)
    with pytest.raises(AccessError):
        await restored.async_load(state)
    save.assert_not_awaited()


async def test_transfer_reconciles_both_devices_recovers_lost_ack_and_detects_changed_target_pin():
    import httpx
    from test_access_engine import CAP, Device

    from custom_components.hikvision_intercom.access.engine import SyncEngine
    from custom_components.hikvision_intercom.client.access import AccessClient
    from custom_components.hikvision_intercom.client.client import (
        ConnectionSettings,
        HikvisionClient,
    )

    repo, _, user, denied, _ = await setup()
    old, new = Device(), Device()
    async with (
        httpx.AsyncClient(transport=httpx.MockTransport(old.handle)) as first,
        httpx.AsyncClient(transport=httpx.MockTransport(new.handle)) as second,
    ):
        drivers = [
            AccessClient(
                HikvisionClient(
                    session,
                    ConnectionSettings(address, "fixture", "fixture-only"),
                    enabled_doors=frozenset({1, 2}),
                )
            )
            for session, address in ((first, "192.0.2.10"), (second, "192.0.2.11"))
        ]
        for driver in drivers:
            driver.capabilities = CAP
        engine = SyncEngine(repo)
        assert not (await engine.async_reconcile("old", drivers[0])).failed
        assert user.employee_no in old.users and denied.employee_no not in old.users
        row = await plan(repo)
        await apply(repo, row)
        new.fail_after = ("UserInfo", "Record")
        await engine.async_reconcile("new", drivers[1])
        # The lost response is recovered using the persisted ownership intent and exact readback.
        await engine.async_reconcile("new", drivers[1])
        assert user.employee_no in new.users and denied.employee_no not in new.users
        assert repo.snapshot()["bindings"]["old"]  # Source cleanup remains pending.
        assert not (await engine.async_reconcile("old", drivers[0])).failed
        assert not old.users and not old.cards and not repo.snapshot()["bindings"]["old"]
        inventory = await drivers[1].async_inventory()
        applied = repo.snapshot()["station_lifecycles"][row["id"]]
        assert jobs.target_verified(repo, repo.snapshot(), applied, inventory, CAP)
        new.users[user.employee_no]["localPassword"] = "111222"
        changed = await drivers[1].async_inventory()
        assert not jobs.target_verified(repo, repo.snapshot(), applied, changed, CAP)


async def test_verified_target_follows_current_edits_and_does_not_ignore_orphan_cards():
    from test_access_engine import CAP

    from custom_components.hikvision_intercom.client.access import StationInventory

    repo, _, user, *_ = await setup()
    row = await plan(repo)
    await apply(repo, row)
    assert not jobs.target_verified(repo, repo.snapshot(), row, StationInventory(), CAP)
    # A deleted person can complete only after the existing deletion journal confirms cleanup.
    await repo.async_delete(user.id, expected_revision=repo.get(user.id).revision)
    assert not jobs.target_verified(repo, repo.snapshot(), row, StationInventory(), CAP)
    snapshot = repo.snapshot()
    snapshot["tombstones"] = {}
    snapshot["retired_cards"] = {}
    snapshot["retired_pins"] = {}
    # Other active transferred people still need reconciliation, so use the empty retirement set.
    snapshot["users"] = {}
    snapshot["bindings"] = {}
    assert jobs.target_verified(repo, snapshot, row, StationInventory(), CAP)
    orphan = StationInventory(cards={"card": {"employeeNo": "foreign", "cardNo": "card"}})
    assert not jobs.target_verified(repo, snapshot, row, orphan, CAP)


async def test_new_second_consent_after_application_never_replays_transfer():
    repo, _, *_ = await setup()
    row = await plan(repo)
    await apply(repo, row)
    before = deepcopy(repo.snapshot()["users"])
    decision = await repo.async_lifecycle_decide(
        job_id=row["id"], actor="second", fingerprint=row["fingerprint"], approve=True
    )
    assert decision["state"] == "applied"
    assert repo.snapshot()["users"] == before
    await apply(repo, row)
    assert repo.snapshot()["users"] == before
