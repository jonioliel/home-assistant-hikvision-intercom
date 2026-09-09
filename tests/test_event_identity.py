"""An event employee number identifies a managed person only with station ownership."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest

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
