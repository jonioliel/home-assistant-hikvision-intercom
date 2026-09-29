"""Atomic personal renewal and identity lifecycle behavior without device I/O."""

import json
from copy import deepcopy
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.access.manager import AccessManager
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.renewal_portal import RenewalPortal
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.access.workflows import Workflows


@pytest.fixture
async def portal_context():
    save = AsyncMock()
    repo = AccessRepository(save)
    await repo.async_load(None)
    person = await repo.async_create(
        {
            "display_name": "Personal",
            "pin": "937426",
            "cards": [{"card_no": "827361"}],
            "valid_from": "2030-01-01T00:00:00Z",
            "valid_until": "2035-01-01T00:00:00Z",
        }
    )
    other = await repo.async_create({"display_name": "Other", "pin": "837425"})
    manager = AccessManager(repo)
    center = Workflows(manager)
    portal = RenewalPortal(center)
    await portal.bind("personal-account", person.id, 0, True)
    yield portal, center, repo, save, person, other
    await manager.async_close()


async def submit(context, key="a" * 32):
    portal, _, _, _, person, _ = context
    return await portal.request(
        "personal-account", person.revision, "2036-01-01T00:00:00Z", "Renew for work", key
    )


async def test_own_projection_is_minimal_and_never_contains_other_people_or_credentials(
    portal_context,
):
    portal, _, repo, _, person, other = portal_context
    before = repo.snapshot()
    own = portal.own("personal-account")
    assert own["name"] == person.display_name and own["requests"] == []
    assert "user_id" not in own and "assignments" not in own and "cards" not in own
    text = json.dumps(own)
    assert all(secret not in text for secret in ["937426", "827361", "Other", other.id])
    assert portal.own("unlinked") == {"linked": False}
    assert repo.snapshot() == before


async def test_request_is_read_only_for_access_until_separate_approval(portal_context):
    portal, center, repo, _, person, _ = portal_context
    before = person.private()
    request = await submit(portal_context)
    assert repo.get(person.id).private() == before
    with pytest.raises(AccessError, match="separate_approver_required"):
        await center.renewal_decide("personal-account", request["id"], True, owner_active=True)
    with pytest.raises(AccessError, match="renewal_identity_inactive"):
        await center.renewal_decide("admin", request["id"], True)
    await center.renewal_decide("admin", request["id"], True, owner_active=True)
    after = repo.get(person.id).private()
    assert after["valid_until"].startswith("2036-01-01")
    for field in ("pin", "cards", "assignments", "group_ids", "permission_overrides", "active"):
        assert after[field] == before[field]
    assert portal.own("personal-account")["requests"][0]["state"] == "approved"
    with pytest.raises(AccessError, match="operation_not_found"):
        await center.renewal_decide("admin", request["id"], True, owner_active=True)


async def test_replay_is_account_bound_and_does_not_duplicate_after_restart(portal_context):
    portal, center, repo, _, person, _ = portal_context
    first = await submit(portal_context)
    second = await submit(portal_context)
    assert first == second and len(center.data["renewals"]) == 1
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    manager = AccessManager(restored)
    try:
        again = RenewalPortal(Workflows(manager))
        assert (
            await again.request(
                "personal-account",
                person.revision,
                "2036-01-01T00:00:00Z",
                "Renew for work",
                "a" * 32,
            )
            == first
        )
    finally:
        await manager.async_close()
    with pytest.raises(AccessError, match="renewal_request_changed"):
        await portal.request(
            "personal-account", person.revision, "2037-01-01T00:00:00Z", "Changed", "a" * 32
        )


async def test_unlink_and_relink_cancel_pending_and_hide_previous_account_binding(portal_context):
    portal, center, repo, _, person, other = portal_context
    request = await submit(portal_context)
    await portal.bind("personal-account", None, 1, True)
    assert center.data["renewals"][request["id"]]["state"] == "cancelled"
    assert portal.own("personal-account") == {"linked": False}
    await portal.bind("personal-account", other.id, 2, True)
    assert portal.own("personal-account")["requests"] == []
    with pytest.raises(AccessError, match="operation_not_found"):
        await portal.cancel("personal-account", request["id"])
    with pytest.raises(AccessError, match="operation_not_found"):
        await center.renewal_decide("admin", request["id"], True, owner_active=True)
    assert repo.get(person.id).valid_until.startswith("2035")


async def test_person_change_invalidates_approval_without_mutating_access(portal_context):
    portal, center, repo, _, person, _ = portal_context
    request = await submit(portal_context)
    await repo.async_update(
        person.id, {"display_name": "Changed"}, expected_revision=person.revision
    )
    assert portal.own("personal-account")["requests"][0]["state"] == "stale"
    with pytest.raises(AccessError, match="revision_conflict"):
        await center.renewal_decide("admin", request["id"], True, owner_active=True)
    assert repo.get(person.id).valid_until.startswith("2035")


async def test_save_failure_is_atomic_for_binding_request_cancel_and_approval(portal_context):
    portal, center, repo, save, person, _ = portal_context
    before = repo.snapshot()
    save.side_effect = OSError("synthetic disk failure")
    with pytest.raises(OSError):
        await submit(portal_context)
    assert repo.snapshot() == before
    with pytest.raises(OSError):
        await portal.bind("personal-account", None, 1, True)
    assert repo.snapshot() == before
    save.side_effect = None
    request = await submit(portal_context)
    before = repo.snapshot()
    save.side_effect = OSError("synthetic disk failure")
    with pytest.raises(OSError):
        await portal.cancel("personal-account", request["id"])
    assert repo.snapshot() == before
    with pytest.raises(OSError):
        await center.renewal_decide("admin", request["id"], True, owner_active=True)
    assert repo.snapshot() == before


@pytest.mark.parametrize(
    "until", ["bad", "2036-01-01T00:00:00", "2020-01-01T00:00:00Z", "2034-01-01T00:00:00Z"]
)
async def test_invalid_or_shortening_time_cannot_create_request(portal_context, until):
    portal, center, _, _, person, _ = portal_context
    with pytest.raises(AccessError):
        await portal.request("personal-account", person.revision, until, "Work", "a" * 32)
    assert center.data["renewals"] == {}


async def test_cancel_is_owner_only_and_duplicate_pending_is_blocked(portal_context):
    portal, center, _, _, person, other = portal_context
    request = await submit(portal_context)
    await portal.bind("other-account", other.id, 1, True)
    with pytest.raises(AccessError, match="operation_not_found"):
        await portal.cancel("other-account", request["id"])
    with pytest.raises(AccessError, match="renewal_already_pending"):
        await submit(portal_context, "b" * 32)
    await portal.cancel("personal-account", request["id"])
    await portal.cancel("personal-account", request["id"])
    assert center.data["renewals"][request["id"]]["state"] == "cancelled"
    assert (await submit(portal_context, "b" * 32))["state"] == "pending"


async def test_v15_migration_preserves_existing_internal_requests_and_people(portal_context):
    _, center, repo, _, person, _ = portal_context
    await center.renewal_request(
        "operator", person.id, person.revision, "2036-01-01T00:00:00Z", "Internal"
    )
    legacy = repo.snapshot()
    legacy["schema"] = 15
    del legacy["workflows"]["renewal_identity"]
    restored = AccessRepository(AsyncMock())
    await restored.async_load(legacy)
    assert restored.snapshot()["schema"] == 16
    assert restored.get(person.id).private() == repo.get(person.id).private()
    assert restored.snapshot()["workflows"]["renewals"] == legacy["workflows"]["renewals"]
    assert restored.snapshot()["workflows"]["renewal_identity"]["bindings"] == {}


@pytest.mark.parametrize(
    "corrupt",
    [
        lambda state: state["workflows"]["renewals"][next(iter(state["workflows"]["renewals"]))][
            "binding"
        ].update(generation=True),
        lambda state: state["workflows"]["renewal_identity"].update(schema=99),
        lambda state: state["workflows"].update(unrecognized={}),
    ],
)
async def test_corrupt_portal_journal_fails_closed(portal_context, corrupt):
    _, _, repo, _, _, _ = portal_context
    await submit(portal_context)
    state = deepcopy(repo.snapshot())
    corrupt(state)
    with pytest.raises(AccessError, match="invalid_storage"):
        await AccessRepository(AsyncMock()).async_load(state)


async def test_expired_request_and_archived_or_inactive_person_never_extend_access(portal_context):
    from datetime import UTC, datetime, timedelta

    portal, center, repo, _, person, _ = portal_context
    row = await submit(portal_context)
    center.data["renewals"][row["id"]]["created_at"] = (
        datetime.now(UTC) - timedelta(days=8)
    ).isoformat()
    assert portal.own("personal-account")["requests"][0]["state"] == "expired"
    with pytest.raises(AccessError, match="approval_expired"):
        await center.renewal_decide("admin", row["id"], True, owner_active=True)
    await portal.cancel("personal-account", row["id"])
    repo._state["users"][person.id]["active"] = False
    assert not portal.own("personal-account")["can_request"]
    with pytest.raises(AccessError, match="renewal_person_unavailable"):
        await portal.request(
            "personal-account", person.revision, "2036-01-01T00:00:00Z", "New request", "b" * 32
        )
    repo._state["users"][person.id]["active"] = True
    repo._state["users"][person.id]["archived_at"] = datetime.now(UTC).isoformat()
    assert portal.own("personal-account") == {"linked": False}
    with pytest.raises(AccessError, match="renewal_person_unavailable"):
        await portal.request(
            "personal-account", person.revision, "2036-01-01T00:00:00Z", "New request", "b" * 32
        )


async def test_personal_requests_preserve_two_administrator_policy(portal_context):
    portal, center, repo, _, person, _ = portal_context
    await center.update_settings(
        0, {"idle_minutes": 0, "reauth_sensitive": False, "dual_approval": True}
    )
    row = await submit(portal_context)
    result = await center.renewal_decide("admin-one", row["id"], True, owner_active=True)
    assert result == {"saved": True, "awaiting_second_approver": True}
    assert repo.get(person.id).valid_until.startswith("2035")
    assert portal.own("personal-account")["requests"][0]["state"] == "pending"
    with pytest.raises(AccessError, match="separate_approver_required"):
        await center.renewal_decide(
            "admin-one", row["id"], True, owner_active=True, reviewer_active=True
        )
    with pytest.raises(AccessError, match="renewal_approver_inactive"):
        await center.renewal_decide("admin-two", row["id"], True, owner_active=True)
    await center.renewal_decide(
        "admin-two", row["id"], True, owner_active=True, reviewer_active=True
    )
    assert repo.get(person.id).valid_until.startswith("2036")
