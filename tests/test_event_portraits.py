"""Event portraits require observed ownership, not just a reused employee number."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

from test_profiles import PHOTO

from custom_components.hikvision_intercom.access.repository import AccessRepository


async def test_event_portrait_proven_owner_and_no_historic_guess():
    repo = AccessRepository(AsyncMock())
    user = await repo.async_create(
        {"display_name": "Person", "employee_no": "00042", "photo": PHOTO}
    )
    repo._state["profile_settings"] = {"values": {"photo_enabled": True}}
    now = datetime.now(UTC)
    later = (now + timedelta(minutes=1)).isoformat()
    assert repo.event_portrait("s", "00042", later) is None
    await repo.async_bind("s", user.id, fingerprint="observed")
    assert repo.event_portrait("s", "00042", later) == {
        "user_id": user.id,
        "revision": user.revision,
    }
    for station, employee, stamp in [
        ("other", "00042", later),
        ("s", "42", later),
        ("s", "00042", (now - timedelta(days=1)).isoformat()),
        ("s", "00042", "invalid"),
    ]:
        assert repo.event_portrait(station, employee, stamp) is None
    repo._state["profile_settings"]["values"]["photo_enabled"] = False
    assert repo.event_portrait("s", "00042", later) is None
    repo._state["profile_settings"]["values"]["photo_enabled"] = True
    await repo.async_delete(user.id, expected_revision=1)
    assert repo.event_portrait("s", "00042", later) is None
