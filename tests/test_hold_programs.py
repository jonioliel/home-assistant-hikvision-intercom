from copy import deepcopy
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.access.hold_programs import HoldPrograms
from custom_components.hikvision_intercom.access.models import AccessError
from tests.test_hold_open import sample

NOW = datetime(2026, 9, 14, 10, tzinfo=UTC)


async def make(enabled=True):
    save, send = AsyncMock(), AsyncMock()
    manager = HoldPrograms(save, send)
    await manager.update("station", 1, 0, sample(), "identity", 1, enabled)
    return manager, save, send


async def test_program_opens_once_and_returns_at_end():
    manager, save, send = await make()
    await manager.tick(NOW)
    await manager.tick(NOW)
    assert [c.args[1] for c in send.await_args_list] == ["alwaysOpen"]
    await manager.tick(datetime(2026, 9, 14, 15, tzinfo=UTC))
    assert [c.args[1] for c in send.await_args_list] == ["alwaysOpen", "close"]
    assert not manager.listing("station")[0]["execution"]["owned"]
    assert "identity" not in manager.listing("station")[0]
    assert save.await_count >= 5


async def test_inactive_program_does_not_write_and_can_be_deleted():
    manager, _, send = await make(False)
    await manager.tick(NOW)
    await manager.action("station", 1, 1, "remove")
    send.assert_not_called()
    assert manager.listing("station") == []


async def test_offline_removal_remains_until_close_acknowledgement():
    manager, _, send = await make()
    await manager.tick(NOW)
    send.side_effect = OSError("offline")
    await manager.action("station", 1, 1, "remove")
    item = manager.listing("station")[0]
    assert item["removing"] and item["execution"]["owned"] and item["error"]
    send.side_effect = None
    await manager.tick(NOW)
    assert manager.listing("station") == []
    assert send.await_args.args[1] == "close"


async def test_restart_restores_before_any_new_open_and_does_not_repeat_window():
    manager, save, send = await make()
    await manager.tick(NOW)
    reloaded = HoldPrograms(save, send)
    reloaded.load(deepcopy(manager.state))
    await reloaded.tick(NOW)
    await reloaded.tick(NOW)
    assert [c.args[1] for c in send.await_args_list] == ["alwaysOpen", "close"]


async def test_lost_open_ack_is_restored_without_reopening():
    manager, _, send = await make()
    send.side_effect = OSError("lost response")
    await manager.tick(NOW)
    send.side_effect = None
    await manager.tick(NOW)
    await manager.tick(NOW)
    assert [c.args[1] for c in send.await_args_list] == ["alwaysOpen", "close"]


async def test_active_edit_and_stale_pause_are_rejected():
    manager, _, _ = await make()
    with pytest.raises(AccessError, match="hold_pause_before_edit"):
        await manager.update("station", 1, 1, sample(), "identity", 1, False)
    with pytest.raises(AccessError, match="revision_conflict"):
        await manager.action("station", 1, 0, "pause")


async def test_failed_storage_prevents_open_command():
    manager, save, send = await make()
    save.side_effect = OSError("disk full")
    with pytest.raises(OSError):
        await manager.tick(NOW)
    send.assert_not_called()


async def test_pause_restores_and_edit_can_resume_after_ack():
    manager, _, send = await make()
    await manager.tick(NOW)
    await manager.action("station", 1, 1, "pause")
    assert not manager.listing("station")[0]["enabled"]
    await manager.update("station", 1, 2, sample(), "identity", 1, True)
    await manager.tick(NOW)
    assert [c.args[1] for c in send.await_args_list] == ["alwaysOpen", "close", "alwaysOpen"]


@pytest.mark.parametrize(
    "data",
    [
        {"schema": True, "programs": {}},
        {"schema": 1, "programs": []},
        {"schema": 2, "programs": {}},
        {"schema": 1, "programs": {"bad": {}}},
    ],
)
def test_corrupt_program_storage_rejected(data):
    with pytest.raises(AccessError):
        HoldPrograms(AsyncMock(), AsyncMock()).load(data)
