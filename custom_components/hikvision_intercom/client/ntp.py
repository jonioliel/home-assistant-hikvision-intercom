"""Capability-gated NTP writes with readback and preserved station DST rules."""

from __future__ import annotations

import asyncio
import ipaddress
from datetime import UTC, datetime
from typing import Any
from xml.etree.ElementTree import Element, SubElement, tostring

from ..access.models import AccessError
from ..clock import device_zone, localize
from ..ntp_settings import normalize
from .clock import ClockClient
from .parser import check_response_status, find_values, parse_payload

BASE = "/ISAPI/System/time"


def xml(root: str, values: dict[str, Any]) -> bytes:
    node = Element(root, {"version": "2.0", "xmlns": "http://www.isapi.org/ver20/XMLSchema"})
    parent = SubElement(node, "NTPServer") if root == "NTPServerList" else node
    for key, value in values.items():
        SubElement(parent, key).text = str(value)
    return bytes(tostring(node, encoding="utf-8"))


async def put(client: Any, path: str, root: str, values: dict[str, Any]) -> None:
    response = await client._request(
        "PUT", path, content=xml(root, values), content_type="application/xml"
    )
    data = parse_payload(response).data
    check_response_status(data)
    codes = find_values(data, "statusCode")
    if not codes or any(str(code) not in {"0", "1"} for code in codes):
        raise AccessError("ambiguous_write")


def server_node(data: dict[str, Any]) -> dict[str, Any]:
    node = data.get("NTPServerList", {}).get("NTPServer")
    if isinstance(node, list):
        if len(node) != 1:
            # Never replace an unknown multi-server configuration.
            raise AccessError("operation_unsupported")
        node = node[0]
    if not isinstance(node, dict) or str(node.get("id")) != "1":
        raise AccessError("operation_unsupported")
    return node


def within(cap: dict[str, Any], key: str, value: int) -> None:
    bounds = cap.get(key)
    if not isinstance(bounds, dict):
        raise AccessError("operation_unsupported")
    try:
        supported = int(bounds["@min"]) <= value <= int(bounds["@max"])
    except (ValueError, TypeError, KeyError):
        raise AccessError("invalid_response") from None
    if not supported:
        raise AccessError("invalid_fields")


async def synchronize(client: Any, values: dict[str, Any], *, copy_system: bool) -> dict[str, Any]:
    values = normalize(values)
    async with asyncio.timeout(50), client._write_lock:
        await client.async_confirm_identity()
        caps = (await client._get(BASE + "/capabilities")).get("Time", {})
        modes = caps.get("timeMode", {}).get("@opt", "").split(",")
        if "NTP" not in modes or (copy_system and "manual" not in modes):
            raise AccessError("operation_unsupported")
        time = (await client._get(BASE)).get("Time", {})
        zone_text = time.get("timeZone")
        if not isinstance(zone_text, str) or not zone_text:
            raise AccessError("invalid_response")
        zone = device_zone(zone_text)
        cap = server_node(await client._get(BASE + "/ntpServers/capabilities"))
        original = server_node(await client._get(BASE + "/ntpServers"))
        within(cap, "portNo", values["port"])
        within(cap, "synchronizeInterval", values["interval"])
        try:
            ipaddress.IPv4Address(values["server"])
            kind, field = "ipaddress", "ipAddress"
        except ValueError:
            kind, field = "hostname", "hostName"
        if kind not in cap.get("addressingFormatType", {}).get("@opt", "").split(","):
            raise AccessError("operation_unsupported")
        expected = {
            "id": "1",
            "addressingFormatType": kind,
            field: values["server"],
            "portNo": values["port"],
            "synchronizeInterval": values["interval"],
        }
        if "enabled" in original:
            expected["enabled"] = "true"
        # Configuration save and clock synchronization are separate, explicitly reported stages.
        await put(client, BASE + "/ntpServers", "NTPServerList", expected)
        observed = server_node(await client._get(BASE + "/ntpServers"))
        if any(str(observed.get(key)) != str(value) for key, value in expected.items()):
            raise AccessError("readback_mismatch")
        if copy_system:
            # Restore NTP even when the manual-time acknowledgement is lost.
            try:
                await put(
                    client,
                    BASE,
                    "Time",
                    {
                        "timeMode": "manual",
                        "timeZone": zone_text,
                        "localTime": localize(datetime.now(UTC), zone).isoformat(
                            timespec="seconds"
                        ),
                    },
                )
            finally:
                await put(client, BASE, "Time", {"timeMode": "NTP", "timeZone": zone_text})
        else:
            await put(client, BASE, "Time", {"timeMode": "NTP", "timeZone": zone_text})
        readback = (await client._get(BASE)).get("Time", {})
        if readback.get("timeMode") != "NTP" or readback.get("timeZone") != zone_text:
            raise AccessError("readback_mismatch")
        clock = await ClockClient(client).async_read()
        measurement = clock.get("measurement", {})
        skew = measurement.get("estimated_skew_seconds")
        return {
            "configuration_verified": True,
            "server": values["server"],
            "clock": clock,
            "clock_verified": measurement.get("status") == "measured"
            and isinstance(skew, (int, float))
            and abs(skew) + (measurement.get("uncertainty_seconds") or 0) <= 5,
            "copied_system": copy_system,
        }
