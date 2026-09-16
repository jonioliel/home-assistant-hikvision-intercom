"""Allowlisted station administration; vendor pages 410–414 and 502–503.

Configuration readback proves stored values, not physical relay behavior.
Privilege passwords are projected as booleans only; unknown is not absent.
"""

from __future__ import annotations

import asyncio
from typing import Any
from xml.etree.ElementTree import Element, SubElement, tostring

from ..access.models import AccessError
from ..exceptions import HikvisionValidationError
from .client import HikvisionClient

FIELDS = ("doorName", "openDuration", "relayReverseEnabled")
PASSWORD_FIELDS = (
    "engineeringConfigured",
    "setupAlarmConfigured",
    "householderUnlockConfigured",
    "antiHijackingConfigured",
    *(f"public{i}Configured" for i in range(1, 17)),
    "sendCardConfigured",
)


def boolean(value: Any) -> bool | None:
    if value is True or value == "true":
        return True
    if value is False or value == "false":
        return False
    return None


def number(value: Any) -> int:
    if isinstance(value, str) and value.isascii() and value.isdecimal():
        value = int(value)
    if type(value) is not int or not 0 <= value <= 65535:
        raise HikvisionValidationError("Invalid technical parameter")
    return value


def door_values(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise HikvisionValidationError("Missing door parameters")
    result: dict[str, Any] = {}
    if "doorName" in data:
        name = data["doorName"]
        if not isinstance(name, str) or not 1 <= len(name) <= 64:
            raise HikvisionValidationError("Invalid door name")
        result["doorName"] = name
    if "openDuration" in data:
        result["openDuration"] = number(data["openDuration"])
    if "relayReverseEnabled" in data:
        value = boolean(data["relayReverseEnabled"])
        if value is None:
            raise HikvisionValidationError("Invalid relay parameter")
        result["relayReverseEnabled"] = value
    return result


def constraints(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise HikvisionValidationError("Missing door capabilities")
    result: dict[str, Any] = {}
    for field in FIELDS:
        cap = data.get(field)
        if not isinstance(cap, dict):
            continue
        if field == "relayReverseEnabled":
            if cap.get("@opt") in ("true,false", "false,true"):
                result[field] = {"type": "boolean"}
        else:
            low, high = number(cap.get("@min")), number(cap.get("@max"))
            if low > high or high > (64 if field == "doorName" else 255):
                raise HikvisionValidationError("Unsupported technical bounds")
            result[field] = {
                "type": "text" if field == "doorName" else "integer",
                "min": low,
                "max": high,
            }
    return result


async def read_door(client: HikvisionClient, door: int) -> dict[str, Any]:
    if type(door) is not int or door not in (1, 2):
        raise HikvisionValidationError("Invalid door identifier")
    path = f"/ISAPI/AccessControl/Door/param/{door}"
    cap = constraints((await client._get(path + "/capabilities")).get("DoorParam"))
    values = door_values((await client._get(path)).get("DoorParam"))
    return {
        "door": door,
        "values": values,
        "constraints": {k: v for k, v in cap.items() if k in values},
    }


async def update_door(
    client: HikvisionClient, door: int, expected: Any, changes: Any
) -> dict[str, Any]:
    if not isinstance(changes, dict) or not changes or set(changes) - set(FIELDS):
        raise HikvisionValidationError("Unsupported technical change")
    async with asyncio.timeout(40), client._write_lock:
        await client.async_confirm_identity()
        current = await read_door(client, door)
        if expected != current["values"]:
            raise HikvisionValidationError("Door parameters changed; reload before saving")
        for key, value in changes.items():
            cap = current["constraints"].get(key)
            if cap is None:
                raise HikvisionValidationError("Technical field not advertised")
            if cap["type"] == "boolean":
                valid = type(value) is bool
            elif cap["type"] == "integer":
                valid = type(value) is int and cap["min"] <= value <= cap["max"]
            else:
                valid = (
                    isinstance(value, str)
                    and cap["min"] <= len(value) <= cap["max"]
                    and not any(ord(c) < 32 for c in value)
                )
            if not valid:
                raise HikvisionValidationError("Technical field outside advertised bounds")
        desired = {**current["values"], **changes}
        if desired != current["values"]:
            root = Element(
                "DoorParam", {"xmlns": "http://www.isapi.org/ver20/XMLSchema", "version": "2.0"}
            )
            # Partial PUT contains only explicitly changed, documented writable nodes.
            for key, value in changes.items():
                SubElement(root, key).text = (
                    str(value).lower() if type(value) is bool else str(value)
                )
            await client._request(
                "PUT",
                f"/ISAPI/AccessControl/Door/param/{door}",
                content=tostring(root),
                content_type="application/xml",
            )
        observed = await read_door(client, door)
        if observed["values"] != desired:
            raise HikvisionValidationError("Technical change not confirmed by readback")
        return observed


def password_status(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise HikvisionValidationError("Missing privilege password status")
    states = {key: boolean(payload.get(key)) for key in PASSWORD_FIELDS}
    public = [states[f"public{i}Configured"] for i in range(1, 17)]
    return {
        "states": states,
        "public_pin_state": "configured"
        if any(v is True for v in public)
        else "absent"
        if all(v is False for v in public)
        else "unknown",
    }


async def hold_command(client: Any, door: int, command: str, *, commissioned: bool = False) -> None:
    """Prepared identity-bound adapter. Never called by draft saving or runtime timers."""
    if not commissioned:
        raise AccessError("schedule_writes_unverified")
    if (
        type(door) is not int
        or door not in client.enabled_doors
        or command not in {"alwaysOpen", "close"}
    ):
        raise AccessError("operation_unsupported")
    async with asyncio.timeout(30), client._write_lock:
        await client.async_confirm_identity()
        await verify_hold_support(client, door)
        from .parser import find_values, parse_payload

        body = (
            '<RemoteControlDoor version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">'
            f"<cmd>{command}</cmd></RemoteControlDoor>"
        ).encode()
        result = parse_payload(
            await client._request(
                "PUT", f"/ISAPI/AccessControl/RemoteControl/door/{door}", content=body
            )
        ).data
        codes = find_values(result, "statusCode")
        if not codes or any(str(code) != "1" for code in codes):
            raise AccessError("ambiguous_write")


async def verify_hold_support(client: Any, door: int) -> None:
    caps = await client._get("/ISAPI/AccessControl/RemoteControl/door/capabilities")
    root = caps.get("RemoteControlDoor", {})
    allowed = root.get("cmd", {}).get("@opt", "").split(",")
    bounds = root.get("doorNo", {})
    low, high = number(bounds.get("@min")), number(bounds.get("@max"))
    if (
        low is None
        or high is None
        or not low <= door <= high
        or not {"alwaysOpen", "close"} <= set(allowed)
    ):
        raise AccessError("operation_unsupported")
