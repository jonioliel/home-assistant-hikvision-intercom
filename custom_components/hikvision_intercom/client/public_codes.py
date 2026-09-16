"""Public PIN management following the station web client's ISAPI contract.

Only public slots are writable. Codes are transient, never listed or persisted.
The compatibility path is explicit and never claims advertised device support.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from ..access.models import AccessError, utc_now
from ..exceptions import HikvisionUnsupportedError
from .parser import check_response_status, parse_payload
from .technical import password_status

BASE = "/ISAPI/VideoIntercom/"
TYPES = (5, 6, 7, *range(9, 22))


async def status(client: Any) -> dict[str, Any]:
    raw = (await client._get(BASE + "PrivilegePasswordStatus")).get("PrivilegePasswordStatus")
    result = password_status(raw)
    result["checked_at"] = utc_now()
    return result


def bounds(cap: Any, name: str, default: tuple[int, int]) -> tuple[int, int]:
    node = cap.get(name, {})
    low, high = node.get("@min", default[0]), node.get("@max", default[1])
    if type(low) is not int or type(high) is not int or not 0 <= low <= high <= 64:
        raise AccessError("invalid_response")
    return low, high


async def capabilities(client: Any) -> dict[str, Any]:
    try:
        data = await client._get(BASE + "PrivilegePasswordCfg/capabilities?format=json")
    except HikvisionUnsupportedError:
        return {"advertised": False, "slots": list(range(1, 17)), "min": 4, "max": 6}
    cap = data.get("PrivilegePasswordCfg")
    if not isinstance(cap, dict):
        raise AccessError("invalid_response")
    options = cap.get("passwordType", {}).get("@opt", [])
    if not isinstance(options, list) or any(type(x) is not int for x in options):
        raise AccessError("invalid_response")
    low, high = bounds(cap, "newPassword", (4, 6))
    return {
        "advertised": True,
        "slots": [i + 1 for i, item in enumerate(TYPES) if item in options],
        "min": max(4, low),
        "max": min(16, high),
        "locks": "lockIDList" in cap,
    }


async def inspect(client: Any) -> dict[str, Any]:
    await client.async_confirm_identity()
    return {"status": await status(client), "capabilities": await capabilities(client)}


async def mutate(client: Any, msg: dict[str, Any]) -> dict[str, Any]:
    slot, action = msg["slot"], msg["action"]
    if type(slot) is not int or not 1 <= slot <= 16 or action not in {"add", "replace", "remove"}:
        raise AccessError("invalid_fields")
    if msg["confirmed"] is not True or type(msg["expected"]) is not bool:
        raise AccessError("invalid_fields")
    door = msg["door"]
    if type(door) is not int or door not in client.enabled_doors:
        raise AccessError("unmanaged_lock")
    async with asyncio.timeout(45), client._write_lock:
        await client.async_confirm_identity()
        caps = await capabilities(client)
        if not caps["advertised"] and msg["compatibility"] is not True:
            raise AccessError("operation_unsupported")
        if slot not in caps["slots"]:
            raise AccessError("operation_unsupported")
        current = await status(client)
        key = f"public{slot}Configured"
        if current["states"][key] is not msg["expected"]:
            raise AccessError("revision_conflict")
        if msg["expected"] != (action != "add"):
            raise AccessError("revision_conflict")
        old, new = msg["old_pin"], msg["new_pin"]
        if action != "add" and (
            not isinstance(old, str)
            or not old.isascii()
            or not old.isdecimal()
            or not 4 <= len(old) <= 16
        ):
            raise AccessError("invalid_fields")
        if action != "remove" and (
            not isinstance(new, str)
            or not new.isascii()
            or not new.isdecimal()
            or not caps["min"] <= len(new) <= caps["max"]
        ):
            raise AccessError("invalid_fields")
        if action == "remove":
            method, endpoint = "POST", "DeletePrivilegePasswordList"
            payload = {"passwordTypeList": [TYPES[slot - 1]], "password": old}
        else:
            if caps["advertised"] and not caps.get("locks"):
                # Cannot promise which output this credential grants without a mapping.
                raise AccessError("operation_unsupported")
            method, endpoint = "PUT", "PrivilegePasswordCfg"
            body = {
                "passwordType": TYPES[slot - 1],
                "newPassword": new,
                "lockIDList": [int(door == 1), int(door == 2)],
            }
            if action == "replace":
                body["oldPassword"] = old
            payload = {"PrivilegePasswordCfg": body}
        response = await client._request(
            method,
            BASE + endpoint + "?format=json",
            content=json.dumps(payload).encode(),
            content_type="application/json",
        )
        parsed = parse_payload(response).data
        check_response_status(parsed)
        # Empty HTTP success is not write acknowledgement.
        from .parser import find_values

        if not find_values(parsed, "statusCode") or any(
            str(v) != "1" for v in find_values(parsed, "statusCode")
        ):
            raise AccessError("ambiguous_write")
        observed = await status(client)
        if observed["states"][key] is not (action != "remove"):
            raise AccessError("readback_mismatch")
        return {
            "status": observed,
            "capabilities": caps,
            "acknowledged": True,
            "physical_verified": False,
        }
