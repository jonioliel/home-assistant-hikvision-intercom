"""Contact data round-trips without changing device intent or leaking into audit."""

from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.access.admin_audit import audit_actor
from custom_components.hikvision_intercom.access.csv_transfer import (
    desired_fields,
    export_users,
    parse_csv,
    row_patch,
)
from custom_components.hikvision_intercom.access.models import (
    AccessError,
    build_user,
    phone_value,
)
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.phone import mobile_display


@pytest.mark.parametrize("number", ["0501234567", "+972 50-123-4567", "(020) 1234 5678", ""])
async def test_phone_roundtrip_local_only(number):
    repo = AccessRepository(AsyncMock())
    user = await repo.async_create(
        {"display_name": "Demo", "assignments": {"s": {"enabled": True, "allowed_locks": [1]}}}
    )
    intent = desired_fields(user)
    with audit_actor("admin", "users/update"):
        updated = await repo.async_update(user.id, {"phone": number}, expected_revision=1)
    assert updated.public()["phone"] == mobile_display(number)
    assert desired_fields(updated) == intent
    if number:
        assert number not in str(repo.snapshot()["admin_audit"])
    saved = AccessRepository(AsyncMock())
    await saved.async_load(repo.snapshot())
    assert saved.get(user.id).phone == mobile_display(number)
    _, row = parse_csv(export_users([updated]))[0]
    patch = row_patch(row, updated, {"s": "Station"})
    rebuilt = build_user(
        patch, employee_no=updated.employee_no, now=updated.updated_at, previous=updated
    )
    assert rebuilt.phone == mobile_display(number)
    await repo.async_delete(user.id, expected_revision=2)
    assert repo.snapshot()["tombstones"][user.id]["record"]["phone"] == ""


@pytest.mark.parametrize(
    "number", [12345678, None, "050123\n4567", "call me", "+123", "1" * 16, "++123456789"]
)
def test_phone_rejects_malformed_values(number):
    with pytest.raises(AccessError, match="invalid_phone"):
        phone_value(number)


async def test_schema_six_phone_migration_is_atomic():
    repo = AccessRepository(AsyncMock())
    user = await repo.async_create({"display_name": "Legacy"})
    raw = repo.snapshot()
    raw["schema"] = 6
    raw.pop("sync_operations")
    raw["users"][user.id].pop("phone")
    save = AsyncMock(side_effect=OSError("disk"))
    restored = AccessRepository(save)
    with pytest.raises(OSError):
        await restored.async_load(raw)
    save.side_effect = None
    await restored.async_load(raw)
    assert restored.get(user.id).phone == ""
    assert restored.snapshot()["schema"] == 10
