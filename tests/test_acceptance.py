"""Attestations survive reload only after durable save; no automatic acceptance."""

from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.access.acceptance import Acceptance
from custom_components.hikvision_intercom.access.models import AccessError


async def test_roundtrip_and_revision_conflict():
    save = AsyncMock()
    store = Acceptance(save)
    assert store.public("station")["results"] == {}
    result = await store.update("station", "pin_remove", "passed", 0)
    assert result["revision"] == 1 and result["results"]["pin_remove"]["basis"] == "operator_report"
    clone = Acceptance(AsyncMock())
    await clone.async_load(save.call_args.args[0])
    assert clone.public("station") == result
    with pytest.raises(AccessError):
        await store.update("station", "relay", "passed", 0)
    assert save.await_count == 1


async def test_failed_save_does_not_publish_result():
    store = Acceptance(AsyncMock(side_effect=OSError("disk")))
    with pytest.raises(OSError):
        await store.update("station", "relay", "passed", 0)
    assert store.public("station")["results"] == {} and store.public("station")["revision"] == 0


@pytest.mark.parametrize(
    ("step", "state"),
    [("arbitrary", "passed"), ("relay", "automatic"), ("audio", "secret"), ("", "failed")],
)
async def test_fixed_checklist_rejects_unbounded_input(step, state):
    save = AsyncMock()
    store = Acceptance(save)
    with pytest.raises(AccessError):
        await store.update("s", step, state, 0)
    save.assert_not_called()


@pytest.mark.parametrize(
    "data",
    [
        {},
        {"schema": 2, "revision": 0, "stations": {}},
        {"schema": 1, "revision": True, "stations": {}},
        {"schema": 1, "revision": 0, "stations": {"s": {"unknown": {}}}},
        {
            "schema": 1,
            "revision": 0,
            "stations": {
                "s": {"relay": {"state": "passed", "checked_at": "bad", "basis": "operator_report"}}
            },
        },
    ],
)
async def test_invalid_storage_fails_closed(data):
    store = Acceptance(AsyncMock())
    with pytest.raises(AccessError):
        await store.async_load(data)
