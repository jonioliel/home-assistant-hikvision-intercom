"""Offline fault injection for the prepared HA hold-open path."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.access.hold_open import (
    HoldOpenDrafts,
    HoldOpenExecutor,
    window,
)
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.schedules import DAYS


def sample():
    return {
        "timezone": "Asia/Jerusalem",
        "schedule": {
            "name": "Cleaning",
            "weekly": {
                day: [{"start": "12:00", "end": "18:00"}] if day in ("Monday", "Thursday") else []
                for day in DAYS
            },
            "holidays": [],
        },
    }


def test_local_time_end_exclusive_and_one_day_override():
    data = sample()
    assert window(data, datetime(2026, 9, 14, 9, tzinfo=UTC))
    assert window(data, datetime(2026, 9, 14, 15, tzinfo=UTC)) is None
    data["schedule"]["holidays"] = [
        {
            "name": "One day",
            "start": "2026-09-15",
            "end": "2026-09-15",
            "periods": [{"start": "10:00", "end": "11:00"}],
        }
    ]
    assert window(data, datetime(2026, 9, 15, 7, tzinfo=UTC))
    assert window(data, datetime(2026, 9, 16, 7, tzinfo=UTC)) is None


async def test_draft_failure_and_revision_do_not_publish():
    save = AsyncMock(side_effect=OSError())
    drafts = HoldOpenDrafts(save)
    with pytest.raises(OSError):
        await drafts.update("a", 1, 0, sample())
    assert drafts.get("a", 1) is None
    save.side_effect = None
    item = await drafts.update("a", 1, 0, sample())
    assert item["revision"] == 1
    with pytest.raises(AccessError):
        await drafts.update("a", 1, 0, sample())
    restored = HoldOpenDrafts(AsyncMock())
    restored.load(drafts.state)
    assert restored.get("a", 1) == item
    assert restored.get("a", 2) is None


async def test_uncommissioned_worker_never_writes():
    send = AsyncMock()
    worker = HoldOpenExecutor(AsyncMock(), send)
    with pytest.raises(AccessError, match="schedule_writes_unverified"):
        await worker.tick("window")
    send.assert_not_called()


async def test_write_ahead_blocks_open_on_disk_failure():
    send = AsyncMock()
    worker = HoldOpenExecutor(AsyncMock(side_effect=OSError()), send, commissioned=True)
    with pytest.raises(OSError):
        await worker.tick("window")
    send.assert_not_called()


async def test_lost_open_response_restores_without_reopening_same_window():
    send = AsyncMock(side_effect=[TimeoutError(), None])
    worker = HoldOpenExecutor(AsyncMock(), send, commissioned=True)
    with pytest.raises(TimeoutError):
        await worker.tick("window")
    assert worker.state["owned"]
    await worker.tick("window")
    await worker.tick("window")
    assert [c.args[0] for c in send.call_args_list] == ["alwaysOpen", "close"]
    assert not worker.state["owned"]


async def test_restart_restores_even_inside_original_window():
    save, send = AsyncMock(), AsyncMock()
    worker = HoldOpenExecutor(save, send, commissioned=True)
    await worker.tick("window")
    restored = HoldOpenExecutor(save, send, commissioned=True)
    restored.load(worker.state)
    await restored.tick("window")
    await restored.tick("window")
    assert [c.args[0] for c in send.call_args_list] == ["alwaysOpen", "close"]


async def test_failed_restore_retains_ownership_and_retries_only_restore():
    send = AsyncMock(side_effect=[None, TimeoutError(), None])
    worker = HoldOpenExecutor(AsyncMock(), send, commissioned=True)
    await worker.tick("window")
    with pytest.raises(TimeoutError):
        await worker.tick(None)
    assert worker.state["owned"]
    await worker.tick(None)
    assert [c.args[0] for c in send.call_args_list] == ["alwaysOpen", "close", "close"]


def test_invalid_zone_and_storage_rejected():
    drafts = HoldOpenDrafts(AsyncMock())
    with pytest.raises(AccessError):
        drafts.load({"schema": True, "drafts": {}})
    data = sample()
    data["timezone"] = "invalid-zone"
    with pytest.raises(AccessError):
        window(data, datetime.now(UTC))
