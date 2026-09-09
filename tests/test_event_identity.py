"""An event employee number identifies a managed person only with station ownership."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.repository import AccessRepository


@pytest.mark.parametrize(
    "case,expected",
    [
        ("observed", "Resident"),
        ("unbound", None),
        ("other_station", None),
        ("create_intent", None),
        ("different_identifier", None),
        ("old_history", None),
        ("deleted", None),
        ("invalid_time", None),
    ],
)
async def test_event_name_requires_observed_station_ownership(case, expected):
    repo = AccessRepository(AsyncMock())
    await repo.async_load(None)
    user = await repo.async_create({"display_name": "Resident", "employee_no": "00042"})
    if case != "unbound":
        await repo.async_bind(
            "b" if case == "other_station" else "a",
            user.id,
            fingerprint=None if case == "create_intent" else "observed",
        )
    when = datetime.now(UTC) + timedelta(seconds=1)
    if case == "old_history":
        when -= timedelta(days=1)
    if case == "deleted":
        await repo.async_delete(user.id, expected_revision=user.revision)
    assert (
        repo.event_person_name(
            "a",
            "42" if case == "different_identifier" else "00042",
            "invalid" if case == "invalid_time" else when.isoformat(),
        )
        == expected
    )


@pytest.mark.parametrize("mode", ["bind", "adopt"])
async def test_earlier_central_user_does_not_identify_events_before_station_ownership(mode):
    repo = AccessRepository(AsyncMock())
    await repo.async_load(None)
    with patch(
        "custom_components.hikvision_intercom.access.repository.utc_now",
        return_value="2026-09-01T00:00:00+00:00",
    ):
        user = await repo.async_create({"display_name": "Current resident", "employee_no": "00042"})
        await repo.async_bind("a", user.id, fingerprint="observed-a")
    with patch(
        "custom_components.hikvision_intercom.access.repository.utc_now",
        return_value="2026-09-10T00:00:00+00:00",
    ):
        if mode == "adopt":
            await repo.async_adopt(
                "b",
                {"employee_no": "00042"},
                fingerprint="observed-b",
                existing_user_id=user.id,
                expected_revision=user.revision,
            )
        else:
            await repo.async_bind("b", user.id, fingerprint="observed-b")
    assert repo.event_person_name("a", "00042", "2026-09-05T12:00:00+00:00") == "Current resident"
    # The same ID could have belonged to somebody else at B before the adoption.
    assert repo.event_person_name("b", "00042", "2026-09-05T12:00:00+00:00") is None
    assert repo.event_person_name("b", "00042", "2026-09-10T00:00:01+00:00") == "Current resident"


async def test_legacy_binding_waits_for_observation_and_preserves_its_time_on_reload():
    save = AsyncMock()
    repo = AccessRepository(save)
    await repo.async_load(None)
    user = await repo.async_create(
        {
            "display_name": "Resident",
            "employee_no": "00042",
            "assignments": {"a": {"enabled": True, "allowed_locks": [1]}},
        }
    )
    await repo.async_bind("a", user.id, fingerprint="observed")
    legacy = repo.snapshot()
    legacy["bindings"]["a"][user.id].pop("identity_observed_at", None)
    await repo.async_load(legacy)
    assert repo.snapshot()["bindings"] == legacy["bindings"]
    assert repo.event_person_name("a", "00042", "2026-09-01T00:00:00+00:00") is None
    with patch(
        "custom_components.hikvision_intercom.access.repository.utc_now",
        return_value="2026-09-10T00:00:00+00:00",
    ):
        await repo.async_record_observation(
            "a", user.id, fingerprint="observed", applied_revision=user.revision
        )
    with patch(
        "custom_components.hikvision_intercom.access.repository.utc_now",
        return_value="2026-09-11T00:00:00+00:00",
    ):
        await repo.async_record_observation(
            "a", user.id, fingerprint="observed", applied_revision=user.revision
        )
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    assert restored.event_person_name("a", "00042", "2026-09-09T23:59:59+00:00") is None
    assert restored.event_person_name("a", "00042", "2026-09-10T00:00:01+00:00") == "Resident"
    assert "identity_observed_at" not in str(restored.public())


@pytest.mark.parametrize("invalid", ["not-a-date", "2026-09-10T00:00:00", 123])
async def test_invalid_optional_ownership_time_cannot_be_loaded(invalid):
    repo = AccessRepository(AsyncMock())
    await repo.async_load(None)
    user = await repo.async_create({"display_name": "Resident", "employee_no": "00042"})
    await repo.async_bind("a", user.id, fingerprint="observed")
    data = repo.snapshot()
    data["bindings"]["a"][user.id]["identity_observed_at"] = invalid
    with pytest.raises(AccessError):
        await AccessRepository(AsyncMock()).async_load(data)


async def test_create_intent_does_not_backdate_owner_and_recreated_binding_gets_new_boundary():
    repo = AccessRepository(AsyncMock())
    await repo.async_load(None)
    user = await repo.async_create({"display_name": "Resident", "employee_no": "00042"})
    await repo.async_write_intent(
        "a",
        user.id,
        revision=user.revision,
        expected_fingerprint=None,
        desired_fingerprint="new",
        operation="create",
    )
    assert repo.event_person_name("a", "00042", "2030-01-01T00:00:00+00:00") is None
    with patch(
        "custom_components.hikvision_intercom.access.repository.utc_now",
        return_value="2026-09-10T00:00:00+00:00",
    ):
        await repo.async_record_observation("a", user.id, fingerprint="new", applied_revision=None)
    assert repo.event_person_name("a", "00042", "2026-09-09T23:59:59+00:00") is None
    assert repo.event_person_name("a", "00042", "2026-09-10T00:00:01+00:00") == "Resident"
    await repo.async_confirm_absent("a", user.id)
    with patch(
        "custom_components.hikvision_intercom.access.repository.utc_now",
        return_value="2026-09-11T00:00:00+00:00",
    ):
        await repo.async_bind("a", user.id, fingerprint="recreated")
    assert repo.event_person_name("a", "00042", "2026-09-10T00:00:01+00:00") is None


@pytest.mark.parametrize(
    "error,expected",
    [
        ("device_changed", None),
        ("ambiguous_write", None),
        ("card_owned_elsewhere", "Resident"),
        ("connection_failed", "Resident"),
    ],
)
async def test_identity_discrepancy_breaks_observation_interval_but_network_failure_does_not(
    error, expected
):
    repo = AccessRepository(AsyncMock())
    await repo.async_load(None)
    user = await repo.async_create({"display_name": "Resident", "employee_no": "00042"})
    await repo.async_bind("a", user.id, fingerprint="observed")
    await repo.async_mark("a", user.id, "conflict", error)
    # A worker clears the visible error before its next read; identity evidence
    # must remain invalid until that read succeeds or the admin resolves it.
    await repo.async_mark("a", user.id, "syncing")
    restored = AccessRepository(AsyncMock())
    await restored.async_load(repo.snapshot())
    assert restored.event_person_name("a", "00042", "2030-01-01T00:00:00+00:00") == expected
