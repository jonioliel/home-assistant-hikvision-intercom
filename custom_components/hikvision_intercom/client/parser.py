"""Bounded callers can parse untrusted XML/JSON without executing XML entities."""

import json
from dataclasses import dataclass
from typing import Any
from xml.etree.ElementTree import Element, ParseError

from defusedxml.common import DefusedXmlException
from defusedxml.ElementTree import fromstring

from ..exceptions import (
    HikvisionAuthError,
    HikvisionBusyError,
    HikvisionCapacityError,
    HikvisionConflictError,
    HikvisionDeviceError,
    HikvisionUnsupportedError,
    HikvisionValidationError,
)


@dataclass(slots=True)
class ParsedPayload:
    """Raw in-memory structure; sanitize before storing or exposing."""

    data: dict[str, Any]
    namespaces: list[str]


def local_name(tag: str) -> str:
    """Strip an XML namespace."""
    return tag.rsplit("}", 1)[-1]


def _element(element: Element) -> Any:
    result: dict[str, Any] = {f"@{local_name(k)}": v for k, v in element.attrib.items()}
    for child in element:
        key = local_name(child.tag)
        value = _element(child)
        if key not in result:
            result[key] = value
        elif isinstance(result[key], list):
            result[key].append(value)
        else:
            result[key] = [result[key], value]
    value = (element.text or "").strip()
    if not result:
        return value
    if value:
        result["#text"] = value
    return result


def _validate_shape(data: Any) -> None:
    """Bound recursive traversal before redaction and capability inspection."""
    stack = [(data, 0)]
    nodes = 0
    while stack:
        value, depth = stack.pop()
        nodes += 1
        if depth > 48 or nodes > 20_000:
            raise HikvisionValidationError("Response structure exceeds traversal limits")
        if isinstance(value, dict):
            stack.extend((child, depth + 1) for child in value.values())
        elif isinstance(value, list):
            stack.extend((child, depth + 1) for child in value)


def parse_payload(body: bytes) -> ParsedPayload:
    """Parse by content, including firmware with incorrect content-type headers."""
    try:
        text = body.decode("utf-8-sig").strip()
        if text.startswith(("{", "[")):
            data = json.loads(text)
            if not isinstance(data, dict):
                raise HikvisionValidationError("Expected a JSON object")
            _validate_shape(data)
            return ParsedPayload(data, [])
        if text.startswith("<"):
            root = fromstring(text, forbid_dtd=True, forbid_entities=True, forbid_external=True)
            namespaces = sorted(
                {
                    element.tag[1:].split("}", 1)[0]
                    for element in root.iter()
                    if element.tag.startswith("{")
                }
            )
            data = {local_name(root.tag): _element(root)}
            _validate_shape(data)
            return ParsedPayload(data, namespaces)
    except (ValueError, UnicodeError, ParseError, DefusedXmlException, RecursionError):
        raise HikvisionValidationError("Malformed or unsafe response body") from None
    raise HikvisionValidationError("Response is neither XML nor JSON")


def find_values(data: Any, key: str) -> list[Any]:
    """Return exact field matches; names, enum values and limits remain unmodified."""
    values: list[Any] = []
    if isinstance(data, dict):
        for name, value in data.items():
            if name.casefold() == key.casefold():
                values.append(value)
            values.extend(find_values(value, key))
    elif isinstance(data, list):
        for value in data:
            values.extend(find_values(value, key))
    return values


def check_response_status(data: dict[str, Any]) -> None:
    """HTTP success cannot override an ISAPI ResponseStatus error.

    Code 1 is the generic ISAPI success code; all other reported codes fail.
    Symbolic classifications use observed fixtures and the manufacturer error dictionary.
    """
    for code in find_values(data, "statusCode"):
        if str(code) == "1":
            continue
        if str(code) == "2":
            raise HikvisionBusyError("Device is busy")
        subcodes = {str(s).casefold() for s in find_values(data, "subStatusCode")}
        if subcodes & {"notsupport", "notsupported", "methodnotallowed"}:
            raise HikvisionUnsupportedError("Operation explicitly unsupported")
        if subcodes & {"unauthorized", "nopermission"}:
            raise HikvisionAuthError("Device denied authorization")
        if subcodes & {
            "cardnoalreadyexist",
            "employeenoalreadyexist",
            "deviceuseralreadyexist",
            "userpasswordalreadyexist",
        }:
            raise HikvisionConflictError("Device reported a record conflict")
        if subcodes & {
            "cardfull",
            "userfull",
            "devicecardfull",
            "deviceuserfull",
            "cardfullperuser",
        }:
            raise HikvisionCapacityError("Device reported capacity exhaustion")
        raise HikvisionDeviceError("Device reported an unsuccessful ResponseStatus")
