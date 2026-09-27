from datetime import UTC, datetime, timedelta

import pytest

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.fleet_health import FleetHealth


@pytest.mark.asyncio
async def test_samples_are_bounded_persisted_and_observational():
    saved = []

    async def save(data):
        saved.append(data)

    history = FleetHealth(save)
    now = datetime.now(UTC)
    assert history.record(
        "station-1", online=True, poll_ms=42.3, sync="synced", events="streaming", now=now
    )
    assert not history.record(
        "station-1",
        online=True,
        poll_ms=41,
        sync="synced",
        events="streaming",
        now=now + timedelta(minutes=1),
    )
    assert history.record(
        "station-1",
        online=False,
        poll_ms=41,
        sync="offline",
        events="retrying",
        now=now + timedelta(minutes=2),
    )
    await history.async_flush()
    assert len(saved) == 1
    assert saved[0]["stations"]["station-1"][1]["poll_ms"] is None

    restored = FleetHealth(save)
    restored.load(saved[0])
    public = restored.public("station-1")
    assert len(public["records"]) == 2
    public["records"][0]["online"] = False
    assert restored.public("station-1")["records"][0]["online"] is True


def test_corrupt_history_is_rejected():
    async def save(_data):
        pass

    history = FleetHealth(save)
    with pytest.raises(AccessError):
        history.load({"schema": 1, "stations": {"station-1": [{"at": "2026-09-27"}]}})
