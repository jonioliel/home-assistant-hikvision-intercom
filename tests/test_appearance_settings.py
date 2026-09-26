"""Shared design persistence must not alter access configuration."""

from unittest.mock import AsyncMock, Mock

import pytest

from custom_components.smplwise_access_control.access.models import AccessError
from custom_components.smplwise_access_control.appearance_settings import AppearanceSettings


async def test_default_reload_conflict_and_noop():
    save, changed = AsyncMock(), Mock()
    settings = AppearanceSettings(save, changed)
    assert settings.public() == {"revision": 0, "default": "current"}
    result = await settings.update(0, "access-dark")
    restored = AppearanceSettings(AsyncMock(), Mock())
    restored.load(save.call_args.args[0])
    assert restored.public() == result
    await settings.update(1, "access-dark")
    save.assert_awaited_once()
    changed.assert_called_once()
    with pytest.raises(AccessError, match="revision_conflict"):
        await settings.update(0, "access-light")


async def test_failed_save_preserves_committed_state():
    save, changed = AsyncMock(side_effect=OSError), Mock()
    settings = AppearanceSettings(save, changed)
    with pytest.raises(OSError):
        await settings.update(0, "access-light")
    assert settings.public()["default"] == "current"
    changed.assert_not_called()


@pytest.mark.parametrize(
    "data",
    [
        [],
        {},
        {"schema": 1, "revision": True, "default": "modern"},
        {"schema": 1, "revision": 0, "default": "unknown"},
    ],
)
def test_invalid_storage_is_rejected(data):
    with pytest.raises(AccessError, match="invalid_storage"):
        AppearanceSettings(AsyncMock(), Mock()).load(data)


async def test_invalid_choice_is_not_saved():
    save = AsyncMock()
    with pytest.raises(AccessError, match="invalid_fields"):
        await AppearanceSettings(save, Mock()).update(0, "unknown")
    save.assert_not_awaited()


@pytest.mark.parametrize("choice", ["wiskey-light", "wiskey-dark"])
async def test_v4_appearance_is_persisted_without_changing_existing_schema(choice):
    save, changed = AsyncMock(), Mock()
    settings = AppearanceSettings(save, changed)
    result = await settings.update(0, choice)
    assert result == {"revision": 1, "default": choice}
    stored = save.await_args.args[0]
    assert stored["schema"] == 1
    restored = AppearanceSettings(AsyncMock(), Mock())
    restored.load(stored)
    assert restored.public() == result
