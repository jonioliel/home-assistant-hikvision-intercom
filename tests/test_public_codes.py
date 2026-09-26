"""Public slots use the vendor mapping and never return submitted credentials."""

import asyncio
import json
from unittest.mock import AsyncMock

import pytest

from custom_components.smplwise_access_control.access.models import AccessError
from custom_components.smplwise_access_control.client.public_codes import TYPES, inspect, mutate
from custom_components.smplwise_access_control.exceptions import (
    HikvisionTimeoutError,
    HikvisionUnsupportedError,
)


def client(configured=False, supported=True):
    obj = AsyncMock()
    obj._write_lock = asyncio.Lock()
    obj.enabled_doors = frozenset({1})
    state = {f"public{i}Configured": False for i in range(1, 17)}
    state["public4Configured"] = configured

    async def get(path):
        if "capabilities" in path:
            if not supported:
                raise HikvisionUnsupportedError("Unsupported")
            return {
                "PrivilegePasswordCfg": {
                    "passwordType": {"@opt": list(TYPES)},
                    "newPassword": {"@min": 4, "@max": 6},
                    "lockIDList": {"@size": 1, "@min": 1, "@max": 2},
                }
            }
        return {"PrivilegePasswordStatus": dict(state)}

    async def request(method, path, **kwargs):
        state["public4Configured"] = method != "POST"
        return b'{"statusCode":1,"statusString":"OK"}'

    obj._get.side_effect = get
    obj._request.side_effect = request
    return obj, state


def message(action="add", **changes):
    return {
        "slot": 4,
        "action": action,
        "door": 1,
        "expected": action != "add",
        "old_pin": "123456",
        "new_pin": "654321",
        "compatibility": False,
        "confirmed": True,
        **changes,
    }


@pytest.mark.parametrize("action", ["add", "replace", "remove"])
async def test_lifecycle_payload_and_no_secret_response(action):
    obj, _ = client(action != "add")
    result = await mutate(obj, message(action))
    assert result["acknowledged"] and not result["physical_verified"]
    assert "654321" not in str(result) and "123456" not in str(result)
    args = obj._request.await_args
    body = json.loads(args.kwargs["content"])
    if action == "remove":
        assert args.args[0] == "POST"
        assert body == {"passwordTypeList": [9], "password": "123456"}
    else:
        assert args.args[0] == "PUT"
        assert body["PrivilegePasswordCfg"]["lockIDList"] == [1, 0]
        assert body["PrivilegePasswordCfg"]["passwordType"] == 9
        assert ("oldPassword" in body["PrivilegePasswordCfg"]) == (action == "replace")
    obj.async_confirm_identity.assert_awaited_once()


@pytest.mark.parametrize(
    "changes",
    [
        {"slot": 8, "expected": True},
        {"slot": True},
        {"slot": 0},
        {"slot": 17},
        {"door": 2},
        {"new_pin": "abc"},
        {"new_pin": "1234567"},
        {"confirmed": False},
    ],
)
async def test_invalid_and_stale_requests_never_write(changes):
    obj, _ = client()
    with pytest.raises(AccessError):
        await mutate(obj, message(**changes))
    obj._request.assert_not_awaited()


async def test_compatibility_requires_explicit_opt_in():
    obj, _ = client(supported=False)
    result = await inspect(obj)
    assert not result["capabilities"]["advertised"]
    with pytest.raises(AccessError, match="operation_unsupported"):
        await mutate(obj, message())
    obj._request.assert_not_awaited()
    result = await mutate(obj, message(compatibility=True))
    assert result["status"]["states"]["public4Configured"] is True


async def test_lost_write_is_not_retried():
    obj, _ = client()
    obj._request.side_effect = HikvisionTimeoutError("timeout")
    with pytest.raises(HikvisionTimeoutError):
        await mutate(obj, message())
    assert obj._request.await_count == 1


async def test_readback_mismatch_and_unknown_status_are_not_success():
    obj, state = client()
    obj._request.side_effect = None
    obj._request.return_value = b'{"statusCode":1}'
    with pytest.raises(AccessError, match="readback_mismatch"):
        await mutate(obj, message())
    state.pop("public4Configured")
    obj._request.reset_mock()
    with pytest.raises(AccessError, match="revision_conflict"):
        await mutate(obj, message())
    obj._request.assert_not_awaited()
