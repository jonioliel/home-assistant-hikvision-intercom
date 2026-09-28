"""Named station inheritance and individual fields never widen parent grants."""

from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.operator_scope import (
    guard_fields,
    project_person,
    project_profiles,
    restricted,
)
from custom_components.hikvision_intercom.panel_permissions import (
    AREAS,
    PanelPermissions,
    command_allowed,
    profile_field_allowed,
    station_allowed,
)


def grant(**extra):
    return {"enabled": True, "areas": {key: "manage" for key in AREAS}, **extra}


async def test_group_change_updates_effective_stations_and_revokes_removed_station():
    save = AsyncMock()
    permissions = PanelPermissions(save, Mock())
    operator = SimpleNamespace(id="operator", is_admin=False, is_active=True)
    groups = [{"id": "site", "label": "Site", "station_ids": ["a"]}]
    policy = grant(station_ids=[], station_group_ids=["site"])
    await permissions.update(0, {"operator": policy}, ["operator"], groups)
    assert station_allowed(permissions, operator, "a")
    assert not station_allowed(permissions, operator, "b")
    groups[0]["station_ids"] = ["b"]
    await permissions.update(1, {"operator": policy}, ["operator"], groups)
    assert not station_allowed(permissions, operator, "a")
    assert station_allowed(permissions, operator, "b")
    restored = PanelPermissions(AsyncMock(), Mock())
    restored.load(save.await_args.args[0])
    assert restored.policy(operator) == permissions.policy(operator)
    policy["areas"]["overview"] = "none"
    policy["areas"]["stations"] = "none"
    await permissions.update(2, {"operator": policy}, ["operator"], groups)
    assert not command_allowed(permissions, operator, "stations/test_unlock")


async def test_unknown_group_or_failed_save_never_changes_live_grant():
    save = AsyncMock()
    permissions = PanelPermissions(save, Mock())
    with pytest.raises(AccessError, match="invalid_fields"):
        await permissions.update(
            0, {"x": grant(station_ids=[], station_group_ids=["unknown"])}, ["x"], []
        )
    save.assert_not_awaited()
    save.side_effect = OSError
    with pytest.raises(OSError):
        await permissions.update(0, {}, [], [{"id": "site", "label": "Site", "station_ids": ["a"]}])
    assert permissions.public()["station_groups"] == []


def test_individual_hidden_and_view_fields_are_projected_and_enforced():
    policy = grant(station_ids=None, profile_fields={"salary": "none", "department": "view"})
    person = {"id": "p", "profile": {"salary": "secret", "department": "staff", "title": "Manager"}}
    assert restricted(policy)
    visible = project_person(policy, person)
    assert visible["profile"] == {"department": "staff", "title": "Manager"}
    assert person["profile"]["salary"] == "secret"
    assert not profile_field_allowed(policy, "department", "manage")
    for key in ("salary", "department"):
        with pytest.raises(AccessError, match="field_access_denied"):
            guard_fields(policy, {"profile": {key: "changed"}})
    guard_fields(policy, {"profile": {"title": "Changed"}})
    definitions = {"fields": [{"id": key} for key in person["profile"]]}
    assert [f["id"] for f in project_profiles(policy, definitions)["fields"]] == [
        "department",
        "title",
    ]


def test_child_field_permission_cannot_override_hidden_parent():
    policy = grant(profile_fields={"title": "manage"})
    policy["fields"] = {
        key: "manage" for key in ("phone", "photo", "credentials", "profile", "access")
    }
    policy["fields"]["profile"] = "none"
    assert not profile_field_allowed(policy, "title")
    assert project_person(policy, {"id": "p", "profile": {"title": "secret"}})["profile"] == {}


@pytest.mark.parametrize("schema", [1, 2])
def test_old_permission_schemas_keep_existing_grants(schema):
    policy = grant()
    if schema == 2:
        policy.update(
            station_ids=None,
            fields={
                key: "manage" for key in ("phone", "photo", "credentials", "profile", "access")
            },
        )
    permissions = PanelPermissions(AsyncMock(), Mock())
    original = {"schema": schema, "revision": 4, "users": {"operator": policy}}
    permissions.load(deepcopy(original))
    assert (
        permissions.policy(SimpleNamespace(id="operator", is_admin=False, is_active=True))[
            "station_ids"
        ]
        is None
    )
    assert permissions.revision == 4 and permissions.public()["station_groups"] == []
