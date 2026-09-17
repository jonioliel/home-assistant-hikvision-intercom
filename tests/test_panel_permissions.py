"""Durable Home Assistant user policies fail closed and commit atomically."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.panel_permissions import (
    AREAS,
    PanelPermissions,
    area_allowed,
)


def user(user_id="reader", *, admin=False, active=True):
    return SimpleNamespace(id=user_id, is_admin=admin, is_active=active)


def policy(*, enabled=True, **areas):
    return {
        "enabled": enabled,
        "areas": {area: areas.get(area, "none") for area in AREAS},
    }


async def test_policy_is_revisioned_persistent_and_admins_always_manage():
    save = AsyncMock()
    changed = Mock()
    permissions = PanelPermissions(save, changed)
    reader = user()
    assert not permissions.policy(reader)["allowed"]
    assert area_allowed(permissions, user(admin=True), "management", "manage")

    result = await permissions.update(
        0,
        {reader.id: policy(overview="view", users="manage")},
        {reader.id},
    )
    assert result["revision"] == 1
    assert permissions.permits(reader, "overview", "view")
    assert not permissions.permits(reader, "overview", "manage")
    assert permissions.permits(reader, "users", "manage")
    save.assert_awaited_once()
    changed.assert_called_once_with()

    restored = PanelPermissions(AsyncMock(), lambda: None)
    restored.load(save.await_args.args[0])
    assert restored.policy(reader)["areas"] == permissions.policy(reader)["areas"]


async def test_invalid_or_stale_policy_never_persists():
    save = AsyncMock()
    permissions = PanelPermissions(save, lambda: None)
    with pytest.raises(AccessError, match="revision_conflict"):
        await permissions.update(1, {}, {"reader"})
    with pytest.raises(AccessError, match="user_not_found"):
        await permissions.update(0, {"missing": policy(overview="view")}, {"reader"})
    with pytest.raises(AccessError, match="invalid_fields"):
        await permissions.update(0, {"reader": {"enabled": True, "areas": {}}}, {"reader"})
    save.assert_not_awaited()


@pytest.mark.parametrize(
    "raw",
    [
        {},
        {"schema": 1, "revision": 0, "users": {"reader": {"enabled": True, "areas": {}}}},
        {"schema": 1, "revision": -1, "users": {}},
        {"schema": 2, "revision": 0, "users": {}},
    ],
)
def test_corrupt_permission_storage_is_rejected(raw):
    permissions = PanelPermissions(AsyncMock(), lambda: None)
    with pytest.raises(AccessError, match="invalid_storage"):
        permissions.load(raw)


def test_inactive_users_and_disabled_policies_are_denied():
    permissions = PanelPermissions(AsyncMock(), lambda: None)
    permissions.load(
        {
            "schema": 1,
            "revision": 3,
            "users": {"reader": policy(enabled=False, overview="manage")},
        }
    )
    assert not permissions.policy(user())["allowed"]
    assert not permissions.policy(user(active=False))["allowed"]


async def test_explicit_empty_save_recovers_invalid_storage():
    save = AsyncMock()
    changed = Mock()
    permissions = PanelPermissions(save, changed)
    permissions.recover_from_invalid_storage()
    result = await permissions.update(0, {}, set())
    assert result["revision"] == 1
    save.assert_awaited_once_with({"schema": 1, "revision": 1, "users": {}})
    changed.assert_called_once_with()
