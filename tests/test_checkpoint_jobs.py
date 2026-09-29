"""Interrupted progress and desired state must share a transaction boundary."""

import asyncio
import json
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.access.checkpoint_jobs import CheckpointJobs
from custom_components.hikvision_intercom.access.manager import AccessManager
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.repository import AccessRepository


@pytest.fixture
async def setup_jobs():
    save = AsyncMock()
    repo = AccessRepository(save)
    await repo.async_load(None)
    manager = AccessManager(repo)
    manager.register("a", "Gate", True)
    for i in range(3):
        await repo.async_create(
            {
                "display_name": f"Person {i}",
                "employee_no": str(100 + i),
                "pin": str(726310 + i),
                "assignments": {"a": {"allowed_locks": [1]}},
            }
        )
    jobs = CheckpointJobs(manager, AsyncMock(return_value=True))
    yield jobs, repo, save
    await jobs.close()
    await manager.async_close()


async def prepared(jobs, action="disable"):
    repo = jobs.manager.repository
    result = await jobs.manager.bulk.preview(
        "actor",
        {
            "action": action,
            "selection": [{"user_id": user.id, "revision": user.revision} for user in repo.users()],
        },
    )
    review = jobs.manager.bulk.reviews[result["operation_id"]]
    return await jobs.create(
        "actor", "bulk", review["changes"], stamp=review["stamp"], rules=review["rules"]
    )


async def finished(jobs, job):
    await jobs.action("actor", job["id"], job["revision"], "resume")
    await jobs.tasks[job["id"]]
    return jobs.records("actor")[0]


async def test_complete_masks_plan_and_writes_progress_beside_data(setup_jobs):
    jobs, repo, save = setup_jobs
    job = await prepared(jobs)
    assert job["state"] == "paused" and all(user.active for user in repo.users())
    result = await finished(jobs, job)
    assert result["saved"] == 3 and result["state"] == "completed"
    assert all(not user.active for user in repo.users())
    assert "726310" not in json.dumps(result)
    for call in save.await_args_list:
        state = call.args[0]
        if job["id"] not in state["checkpoint_jobs"]:
            continue
        saved = sum(row["state"] == "saved" for row in state["checkpoint_jobs"][job["id"]]["rows"])
        assert saved == sum(not user["active"] for user in state["users"].values())


async def test_one_stale_person_does_not_block_other_rows(setup_jobs):
    jobs, repo, _ = setup_jobs
    job = await prepared(jobs)
    person = repo.users()[0]
    await repo.async_update(
        person.id, {"display_name": "Changed after review"}, expected_revision=person.revision
    )
    result = await finished(jobs, job)
    assert result["state"] == "completed_with_errors"
    assert result["failed"] == 1 and result["saved"] == 2
    assert repo.get(person.id).active
    assert "revision_conflict" in jobs.error_csv("actor", job["id"])
    assert "726310" not in jobs.error_csv("actor", job["id"])


async def test_restart_pauses_and_resume_never_replays_saved_rows(setup_jobs):
    jobs, repo, _ = setup_jobs
    job = await prepared(jobs)
    await jobs.action("actor", job["id"], job["revision"], "resume")
    await asyncio.sleep(0)
    await jobs.close()
    before = {user.id: user.revision for user in repo.users()}
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    assert restored.snapshot()["checkpoint_jobs"][job["id"]]["state"] in {"paused", "completed"}
    manager = AccessManager(restored)
    manager.register("a", "Gate", True)
    resumed = CheckpointJobs(manager, AsyncMock(return_value=True))
    try:
        current = resumed.records("actor")[0]
        if current["state"] == "paused":
            await finished(resumed, current)
        for user in restored.users():
            assert user.revision <= before[user.id] + 1
    finally:
        await resumed.close()
        await manager.async_close()


async def test_cancel_preserves_existing_changes_and_owner_is_checked(setup_jobs):
    jobs, repo, _ = setup_jobs
    job = await prepared(jobs)
    with pytest.raises(AccessError, match="operation_not_found"):
        await jobs.action("other", job["id"], 1, "cancel")
    assert not jobs.records("other")
    cancelled = await jobs.action("actor", job["id"], 1, "cancel")
    assert cancelled["state"] == "cancelled" and all(user.active for user in repo.users())
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    assert restored.snapshot()["checkpoint_jobs"][job["id"]]["state"] == "cancelled"
    with pytest.raises(AccessError, match="job_finished"):
        await jobs.action("actor", job["id"], cancelled["revision"], "resume")


async def test_revoked_actor_and_failed_persistence_do_not_write_rows(setup_jobs):
    jobs, repo, save = setup_jobs
    job = await prepared(jobs)
    jobs.authorize.return_value = False
    with pytest.raises(AccessError, match="unauthorized"):
        await jobs.action("actor", job["id"], 1, "resume")
    jobs.authorize.return_value = True
    save.side_effect = OSError
    with pytest.raises(OSError):
        await jobs.action("actor", job["id"], 1, "resume")
    assert all(user.active for user in repo.users())


async def test_schema_11_migrates_without_changing_people(setup_jobs):
    _, repo, _ = setup_jobs
    legacy = repo.snapshot()
    legacy.pop("checkpoint_jobs")
    legacy.pop("workflows")
    legacy["schema"] = 11
    legacy.pop("station_lifecycles", None)
    migrated = AccessRepository(AsyncMock())
    await migrated.async_load(legacy)
    assert migrated.snapshot()["users"] == legacy["users"]
    assert migrated.snapshot()["checkpoint_jobs"] == {}


async def test_policy_changed_during_authorization_pauses_before_any_row(setup_jobs):
    jobs, repo, _ = setup_jobs
    job = await prepared(jobs)
    calls = 0

    async def authorize(_actor):
        nonlocal calls
        calls += 1
        if calls == 2:
            await repo._commit(
                lambda state: state["workflows"]["settings"].update(dual_approval=True)
            )
        return True

    jobs.authorize.side_effect = authorize
    result = await finished(jobs, job)
    assert result["state"] == "paused" and result["saved"] == 0
    assert all(person.active for person in repo.users())


async def approve_job(jobs, job):
    await jobs.approval_request("actor", job["id"], job["revision"], "resume")
    review = jobs.approval_review("second", job["id"])
    return await jobs.approval_decide(
        "second", job["id"], review["revision"], review["review_id"], True
    )


async def test_dual_approval_stages_without_mutation_and_a_separate_admin_can_resume(setup_jobs):
    jobs, repo, _ = setup_jobs
    await repo._commit(lambda state: state["workflows"]["settings"].update(dual_approval=True))
    job = await prepared(jobs)
    with pytest.raises(AccessError, match="approval_required"):
        await jobs.action("actor", job["id"], job["revision"], "resume")
    assert all(user.active for user in repo.users())
    approved = await approve_job(jobs, job)
    assert all(user.active for user in repo.users())
    assert (await finished(jobs, approved))["saved"] == 3


async def test_review_masks_credentials_and_cannot_be_self_approved_or_replayed(setup_jobs):
    jobs, _, _ = setup_jobs
    job = await prepared(jobs)
    requested = await jobs.approval_request("actor", job["id"], 1, "resume")
    assert not jobs.pending_reviews("actor")
    assert len(jobs.pending_reviews("second")) == 1
    review = jobs.approval_review("second", job["id"])
    assert "726310" not in json.dumps(review) and "row_hashes" not in json.dumps(review)
    assert len(review["impact"]) == 3
    assert all(
        item["before"]["active"] and not item["after"]["active"] for item in review["impact"]
    )
    with pytest.raises(AccessError, match="separate_approver_required"):
        await jobs.approval_decide(
            "actor", job["id"], requested["revision"], review["review_id"], True
        )
    with pytest.raises(AccessError, match="bulk_review_stale"):
        await jobs.approval_decide("second", job["id"], requested["revision"], "0" * 32, True)
    decided = await jobs.approval_decide(
        "second", job["id"], requested["revision"], review["review_id"], True
    )
    with pytest.raises(AccessError, match="revision_conflict"):
        await jobs.approval_decide(
            "second", job["id"], requested["revision"], review["review_id"], True
        )
    assert decided["state"] == "paused"


async def test_changed_person_invalidates_approval_review_without_granting_access(setup_jobs):
    jobs, repo, _ = setup_jobs
    job = await prepared(jobs)
    requested = await jobs.approval_request("actor", job["id"], 1, "resume")
    review = jobs.approval_review("second", job["id"])
    person = repo.users()[0]
    await repo.async_update(
        person.id, {"display_name": "Changed"}, expected_revision=person.revision
    )
    with pytest.raises(AccessError, match="revision_conflict"):
        await jobs.approval_decide(
            "second", job["id"], requested["revision"], review["review_id"], True
        )
    assert all(user.active for user in repo.users())


@pytest.mark.parametrize("boundary", ["expired", "revoked", "tampered", "rejected"])
async def test_job_consent_boundaries_pause_before_writing(setup_jobs, boundary):
    jobs, repo, _ = setup_jobs
    job = await prepared(jobs)
    await repo._commit(lambda state: state["workflows"]["settings"].update(dual_approval=True))
    approved = await approve_job(jobs, job)
    if boundary in {"expired", "tampered", "rejected"}:

        def alter(state):
            record = state["checkpoint_jobs"][job["id"]]
            if boundary == "expired":
                record["approval"]["expires_at"] = "2000-01-01T00:00:00+00:00"
            elif boundary == "rejected":
                record["approval"]["state"] = "rejected"
            else:
                record["rows"][0]["change"]["data"]["active"] = True

        await repo._commit(alter)
    else:
        jobs.authorize.side_effect = lambda actor: actor != "second"
    with pytest.raises(AccessError, match="approval_required|approval_expired|bulk_review_stale"):
        await jobs.action("actor", job["id"], approved["revision"], "resume")
    assert all(user.active for user in repo.users())


async def test_approved_partial_job_survives_restart_without_replaying_saved_rows(setup_jobs):
    jobs, repo, _ = setup_jobs
    job = await prepared(jobs)
    await repo._commit(lambda state: state["workflows"]["settings"].update(dual_approval=True))
    approved = await approve_job(jobs, job)
    calls = 0

    async def authorize(actor):
        nonlocal calls
        if actor == "actor":
            calls += 1
            return calls < 3
        return True

    jobs.authorize.side_effect = authorize
    partial = await finished(jobs, approved)
    assert partial["saved"] == 1 and partial["state"] == "paused"
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    manager = AccessManager(restored)
    manager.register("a", "Gate", True)
    resumed = CheckpointJobs(manager, AsyncMock(return_value=True))
    before = {person.id: person.revision for person in restored.users()}
    try:
        assert (await finished(resumed, resumed.records("actor")[0]))["saved"] == 3
        already_saved = repo.users()[0].id
        assert restored.get(already_saved).revision == before[already_saved]
    finally:
        await resumed.close()
        await manager.async_close()
