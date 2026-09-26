"""Technical settings never expose PINs or infer absence from missing fields."""

import asyncio
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.client.technical import (
    PASSWORD_FIELDS,
    constraints,
    door_values,
    password_status,
    update_door,
)
from custom_components.hikvision_intercom.exceptions import (
    HikvisionTimeoutError,
    HikvisionValidationError,
)


def test_fixed_pin_status_is_complete_and_secret_free():
    value = {key: "false" for key in PASSWORD_FIELDS}
    value["passwordInfoList"] = {"password": "secret-never-return"}
    assert password_status(value)["public_pin_state"] == "absent"
    assert "secret-never-return" not in str(password_status(value))
    del value["public16Configured"]
    assert password_status(value)["public_pin_state"] == "unknown"
    value["public3Configured"] = "true"
    assert password_status(value)["public_pin_state"] == "configured"


def test_door_projection_never_returns_unrecognized_or_secret_fields():
    assert door_values({"doorName": "Door", "openDuration": "2", "unlockPassword": "SECRET"}) == {
        "doorName": "Door",
        "openDuration": 2,
    }
    assert constraints({"unlockPassword": {"@min": "1", "@max": "8"}}) == {}


def client():
    obj = AsyncMock()
    obj._write_lock = asyncio.Lock()
    obj._get.return_value = {}
    return obj


@pytest.mark.parametrize(
    "changes",
    [
        {"unlockPassword": "1234"},
        {"openDuration": True},
        {"openDuration": 256},
        {"relayReverseEnabled": "false"},
        {"doorName": "bad\x00name"},
    ],
)
async def test_invalid_change_has_no_write(changes):
    from unittest.mock import patch

    c = client()
    current = {
        "door": 1,
        "values": {"openDuration": 2},
        "constraints": {"openDuration": {"type": "integer", "min": 1, "max": 255}},
    }
    with (
        patch(
            "custom_components.hikvision_intercom.client.technical.read_door",
            AsyncMock(return_value=current),
        ),
        pytest.raises(HikvisionValidationError),
    ):
        await update_door(c, 1, current["values"], changes)
    c._request.assert_not_called()


async def test_stale_expected_values_do_not_write():
    from unittest.mock import patch

    c = client()
    with (
        patch(
            "custom_components.hikvision_intercom.client.technical.read_door",
            AsyncMock(return_value={"values": {"openDuration": 4}}),
        ),
        pytest.raises(HikvisionValidationError),
    ):
        await update_door(c, 1, {"openDuration": 2}, {"openDuration": 5})
    c._request.assert_not_called()


async def test_update_requires_readback_and_sends_only_changed_fields():
    from unittest.mock import patch

    c = client()
    first = {
        "values": {"openDuration": 2, "doorName": "Door"},
        "constraints": {"openDuration": {"type": "integer", "min": 1, "max": 255}},
    }
    last = {"values": {"openDuration": 5, "doorName": "Door"}}
    with patch(
        "custom_components.hikvision_intercom.client.technical.read_door",
        AsyncMock(side_effect=[first, last]),
    ):
        assert await update_door(c, 1, first["values"], {"openDuration": 5}) == last
    body = c._request.call_args.kwargs["content"]
    assert b"<openDuration>5</openDuration>" in body and b"doorName" not in body
    c.async_confirm_identity.assert_awaited_once()


async def test_lost_ack_is_never_replayed():
    from unittest.mock import patch

    c = client()
    c._request.side_effect = HikvisionTimeoutError("Unknown")
    current = {
        "values": {"openDuration": 2},
        "constraints": {"openDuration": {"type": "integer", "min": 1, "max": 255}},
    }
    with (
        patch(
            "custom_components.hikvision_intercom.client.technical.read_door",
            AsyncMock(return_value=current),
        ),
        pytest.raises(HikvisionTimeoutError),
    ):
        await update_door(c, 1, current["values"], {"openDuration": 5})
    c._request.assert_awaited_once()
