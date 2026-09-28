"""Station and field policy boundaries, legacy grants and durable revocation."""

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.user_directory import query_users
from custom_components.hikvision_intercom.operator_scope import (
    guard_fields,
    guard_person,
    project_overview,
    project_people,
    project_profiles,
)
from custom_components.hikvision_intercom.panel_permissions import (
    AREAS,
    FIELDS,
    PanelPermissions,
    command_allowed,
    normalize_policy,
    preview_policy,
    station_allowed,
)


def grant(**updates):
    return normalize_policy({"enabled": True, "areas": {key: "manage" for key in AREAS}, **updates})


def actor(*, admin=False, active=True):
    return SimpleNamespace(id="operator", is_admin=admin, is_active=active)


def person(uid="visible", assignments=None):
    return {
        "id": uid,
        "revision": 1,
        "display_name": uid,
        "employee_no": "1001",
        "phone": "050-123-4567",
        "pin_configured": True,
        "cards": [{"masked_number": "•••• 8877"}],
        "photo_configured": True,
        "profile": {"dept": "Secret department"},
        "group_ids": ["local"],
        "valid_from": "2026-10-01T00:00:00Z",
        "valid_until": "2026-10-02T00:00:00Z",
        "assignments": assignments if assignments is not None else {"front": {"enabled": True}},
        "permission_overrides": {"front": "allow", "back": "deny"},
        "timing_readbacks": {"front": {}, "back": {}},
        "access_timing_policy": {"mode": "ha", "bindings": {"front": {}, "back": {}}},
    }


@pytest.mark.parametrize(
    "value",
    [
        {"station_ids": "front"},
        {"station_ids": ["front", "front"]},
        {"station_ids": [None]},
        {"station_ids": [[]]},
        {"station_ids": [""]},
        {"station_ids": ["bad\nname"]},
        {"station_ids": ["s"] * 1001},
        {"fields": {}},
        {"fields": {key: "manage" for key in (*FIELDS, "unknown")}},
        {"fields": {key: ([] if key == "phone" else "manage") for key in FIELDS}},
        {"unknown": True},
    ],
)
def test_malformed_scope_never_becomes_an_unrestricted_grant(value):
    with pytest.raises(AccessError, match="invalid_fields"):
        grant(**value)


async def test_legacy_grant_defaults_and_restricted_command_surface():
    permissions = PanelPermissions(AsyncMock(), lambda: None)
    legacy = {"enabled": True, "areas": {key: "manage" for key in AREAS}}
    permissions.load({"schema": 1, "revision": 7, "users": {"operator": legacy}})
    assert station_allowed(permissions, actor(), "future-station")
    assert command_allowed(permissions, actor(), "sync/all")
    assert command_allowed(permissions, actor(), "users/csv_export")
    assert permissions.policy(actor())["fields"] == {key: "manage" for key in FIELDS}
    await permissions.update(7, {"operator": grant(station_ids=["front"])}, {"operator"})
    assert station_allowed(permissions, actor(), "front")
    assert not station_allowed(permissions, actor(), "back")
    assert command_allowed(permissions, actor(), "stations/test_unlock")
    assert command_allowed(permissions, actor(), "fleet/alerts")
    assert command_allowed(permissions, actor(), "fleet/alerts_action")
    assert not command_allowed(permissions, actor(), "sync/all")
    assert not command_allowed(permissions, actor(), "users/csv_export")
    assert not command_allowed(permissions, actor(), "unknown/new_command")
    assert command_allowed(permissions, actor(admin=True), "sync/all")
    assert not station_allowed(permissions, actor(admin=True, active=False), "front")


async def test_explicit_empty_selection_does_not_mean_all_stations():
    permissions = PanelPermissions(AsyncMock(), lambda: None)
    await permissions.update(0, {"operator": grant(station_ids=[])}, {"operator"})
    assert command_allowed(permissions, actor(), "overview")
    assert not command_allowed(permissions, actor(), "users/list")
    assert not station_allowed(permissions, actor(), "front")
    assert preview_policy(grant(station_ids=[]))["actions"]["door_unlock"] is False


def test_projection_redacts_before_queries_and_never_mutates_owned_records():
    policy = grant(station_ids=["front"], fields={key: "none" for key in FIELDS})
    rows = [person(), person("other", {"back": {"enabled": True}})]
    original = deepcopy(rows)
    visible = project_people(policy, rows)
    assert len(visible) == 1
    assert visible[0]["phone"] == "" and visible[0]["cards"] == []
    assert visible[0]["profile"] == {} and visible[0]["assignments"] == {}
    assert not visible[0]["pin_configured"] and not visible[0]["photo_configured"]
    assert set(visible[0]["redacted_fields"]) == set(FIELDS)
    query = query_users(visible, query="0501234567", filters={}, offset=0, limit=25, snapshot="")
    assert query["total"] == 0
    assert rows == original


def test_shared_person_is_visible_without_outside_station_ids_and_is_not_editable():
    policy = grant(station_ids=["front"])
    shared = person(assignments={"front": {"enabled": True}, "back": {"enabled": True}})
    visible = project_people(policy, [shared])[0]
    assert set(visible["assignments"]) == {"front"}
    assert set(visible["permission_overrides"]) == {"front"}
    assert set(visible["timing_readbacks"]) == {"front"}
    assert set(visible["access_timing_policy"]["bindings"]) == {"front"}
    assert visible["operator_editable"] is False
    with pytest.raises(AccessError, match="person_scope_shared"):
        guard_person(policy, shared, mutate=True)
    with pytest.raises(AccessError, match="unauthorized"):
        guard_person(policy, person(assignments={"back": {}}))


def test_read_only_and_hidden_fields_cannot_be_written():
    fields = {key: "manage" for key in FIELDS}
    fields.update(phone="view", credentials="none")
    policy = grant(fields=fields)
    guard_fields(policy, {"display_name": "Updated"})
    for patch in ({"phone": ""}, {"pin": None}, {"cards": []}):
        with pytest.raises(AccessError, match="field_access_denied"):
            guard_fields(policy, patch)
    preview = preview_policy(policy)
    assert preview["actions"]["people_edit"]
    assert not preview["actions"]["whatsapp_send"]
    assert not preview["actions"]["people_export"]


def test_outstanding_outside_binding_keeps_visible_person_read_only():
    policy = grant(station_ids=["front"])
    row = person()
    pending = frozenset({row["id"]})
    assert (
        project_people(policy, [row], shared_identity_ids=pending)[0]["operator_editable"] is False
    )
    assert project_people(policy, [row])[0]["operator_editable"] is True
    assert row["group_ids"] == ["local"]


def test_scoped_profiles_do_not_offer_global_templates_or_shared_groups():
    profiles = {
        "photo_enabled": True,
        "fields": [],
        "templates": [{"id": "global"}],
        "groups": [
            {"id": "local", "station_ids": ["front"]},
            {"id": "shared", "station_ids": ["front", "back"]},
        ],
    }
    assert (
        project_profiles(grant(station_ids=["front"]), profiles)["groups"] == profiles["groups"][:1]
    )
    assert project_profiles(grant(station_ids=["front"]), profiles)["templates"] == []
    overview = project_overview(
        grant(station_ids=["front"]),
        {
            "stations": [{"id": "front"}, {"id": "back"}],
            "users": [person()],
            "profile_settings": profiles,
            "tombstones": [{"user_id": "deleted"}],
            "sync_operations": [{"station_id": "back"}],
        },
    )
    assert overview["stations"] == [{"id": "front"}]
    assert overview["tombstones"] == [] and overview["sync_operations"] == []


async def test_cancelled_permission_save_finishes_commit_before_releasing_lock():
    started, finish = asyncio.Event(), asyncio.Event()
    saved = []

    async def save(value):
        started.set()
        await finish.wait()
        saved.append(deepcopy(value))

    changed = Mock()
    permissions = PanelPermissions(save, changed)
    pending = asyncio.create_task(
        permissions.update(0, {"operator": grant(station_ids=["front"])}, {"operator"})
    )
    await started.wait()
    pending.cancel()
    await asyncio.sleep(0)
    assert permissions.revision == 0 and not pending.done()
    finish.set()
    with pytest.raises(asyncio.CancelledError):
        await pending
    assert permissions.revision == 1 and saved[0]["schema"] == 2
    assert station_allowed(permissions, actor(), "front")
    assert not station_allowed(permissions, actor(), "back")
    changed.assert_called_once_with()


async def test_failed_save_preserves_previous_authorization():
    save = AsyncMock(side_effect=OSError("disk unavailable"))
    permissions = PanelPermissions(save, Mock())
    permissions.load(
        {
            "schema": 1,
            "revision": 4,
            "users": {"operator": {"enabled": True, "areas": {key: "manage" for key in AREAS}}},
        }
    )
    with pytest.raises(OSError):
        await permissions.update(4, {"operator": grant(station_ids=[])}, {"operator"})
    assert permissions.revision == 4 and station_allowed(permissions, actor(), "front")
