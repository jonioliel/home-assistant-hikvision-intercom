"""Capability-driven person/card ISAPI, with explicit mutation transaction ownership.

Routes and field contracts: docs/MANUFACTURER_PROTOCOL.md. Readback establishes
configuration only; physical credential acceptance remains a separate commissioning result.
"""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from ..exceptions import (
    HikvisionConflictError,
    HikvisionDeviceError,
    HikvisionTimeoutError,
    HikvisionUnsupportedError,
    HikvisionValidationError,
)
from .client import HikvisionClient
from .parser import find_values, parse_payload

MAX_INVENTORY = 20_000


def _integer(value: Any, minimum: int = 0, maximum: int = MAX_INVENTORY) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise HikvisionValidationError("Invalid device count or capability bound")
    return value


def _range(data: Any, *, ceiling: int = 256) -> tuple[int, int]:
    if not isinstance(data, dict):
        raise HikvisionUnsupportedError("Required field capability is missing")
    low, high = _integer(data.get("@min"), 0, ceiling), _integer(data.get("@max"), 1, ceiling)
    if low > high:
        raise HikvisionValidationError("Invalid capability range")
    return low, high


def _options(data: Any) -> frozenset[str]:
    if not isinstance(data, dict):
        return frozenset()
    raw = data.get("@opt", [])
    if isinstance(raw, str):
        raw = raw.split(",")
    if not isinstance(raw, list) or not all(isinstance(item, str) for item in raw):
        return frozenset()
    return frozenset(raw)


def validate_identifier(value: Any, *, maximum: int = 32) -> str:
    """Do not turn malformed or empty selectors into a device-wide operation."""
    if (
        not isinstance(value, str)
        or not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", value)
        or len(value) > maximum
    ):
        raise HikvisionValidationError("Invalid employee identifier")
    return value


def validate_card(value: Any, *, minimum: int = 1, maximum: int = 32) -> str:
    """Keep leading zeros and exact case; no undocumented number conversion."""
    if (
        not isinstance(value, str)
        or not minimum <= len(value) <= maximum
        or not re.fullmatch(r"[A-Za-z0-9_-]+", value)
    ):
        raise HikvisionValidationError("Invalid card identifier")
    return value


@dataclass(frozen=True, slots=True)
class AccessCapabilities:
    user_operations: frozenset[str]
    card_operations: frozenset[str]
    user_page: int
    card_page: int
    max_users: int
    max_cards: int
    cards_per_person: int
    employee_max: int
    name_max: int
    card_min: int
    card_max: int
    user_types: frozenset[str]
    card_types: frozenset[str]
    pin_mode: str
    pin_field: str | None
    pin_min: int = 0
    pin_max: int = 0

    @classmethod
    def from_payloads(
        cls, users: Mapping[str, Any], cards: Mapping[str, Any], mode: Mapping[str, Any]
    ) -> AccessCapabilities:
        user, card = users.get("UserInfo"), cards.get("CardInfo")
        if not isinstance(user, dict) or not isinstance(card, dict):
            raise HikvisionUnsupportedError("Access management capabilities are missing")
        user_search, card_search = user.get("UserInfoSearchCond"), card.get("CardInfoSearchCond")
        if not isinstance(user_search, dict) or not isinstance(card_search, dict):
            raise HikvisionUnsupportedError("Access search is unavailable")
        user_page = _range(user_search.get("maxResults"), ceiling=1000)[1]
        card_page = _range(card_search.get("maxResults"), ceiling=1000)[1]
        card_min, card_max = _range(card.get("cardNo"))
        pin_mode = mode.get("pwMgrMode", "unknown")
        if not isinstance(pin_mode, str):
            pin_mode = "unknown"
        pin_field = (
            {"local": "localPassword", "platform": "password"}.get(pin_mode)
            if isinstance(pin_mode, str)
            else None
        )
        pin_min = pin_max = 0
        if pin_field and pin_field in user:
            pin_min, pin_max = _range(user[pin_field], ceiling=128)
        else:
            pin_field = None
        per_person = card.get("numberPerPerson")
        # An absent limit stays unknown; no manufacturer-example default enables writes.
        per_person = _integer(per_person, 1, MAX_INVENTORY) if per_person is not None else 0
        max_cards = _integer(card.get("maxRecordNum"), 1)
        if per_person == 255:
            per_person = max_cards
        return cls(
            _options(user.get("supportFunction")),
            _options(card.get("supportFunction")),
            min(user_page, 30),
            min(card_page, 30),
            _integer(user.get("maxRecordNum"), 1),
            max_cards,
            per_person,
            _range(user.get("employeeNo"))[1],
            _range(user.get("name"))[1],
            card_min,
            card_max,
            _options(user.get("userType")),
            _options(card.get("cardType")),
            pin_mode if pin_mode in {"local", "platform"} else "unknown",
            pin_field,
            pin_min,
            pin_max,
        )


@dataclass(slots=True, repr=False)
class StationInventory:
    """Private account/credential payloads, never serialize this to diagnostics or UI."""

    users: dict[str, dict[str, Any]] = field(default_factory=dict)
    cards: dict[str, dict[str, Any]] = field(default_factory=dict)


class AccessClient:
    """Use the station's pooled transport and the same write lock as its relay."""

    def __init__(self, client: HikvisionClient) -> None:
        self.client = client
        self.capabilities: AccessCapabilities | None = None
        self._owner: asyncio.Task[Any] | None = None

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[None]:
        if self._owner is asyncio.current_task():
            raise HikvisionValidationError("Nested mutation transaction")
        async with self.client._write_lock:
            await self.client.async_confirm_identity()
            self._owner = asyncio.current_task()
            try:
                yield
            finally:
                self._owner = None

    def _require_mutation(self, kind: str, operation: str) -> AccessCapabilities:
        if self._owner is not asyncio.current_task() or self._owner is None:
            raise HikvisionValidationError("Mutation requires a serialized transaction")
        if not self.client.enabled_doors:
            raise HikvisionValidationError("Camera-only stations cannot change access records")
        cap = self.capabilities
        if cap is None or operation not in (
            cap.user_operations if kind == "UserInfo" else cap.card_operations
        ):
            raise HikvisionUnsupportedError("Device does not advertise this access operation")
        return cap

    async def _json(
        self, method: str, path: str, data: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        content = (
            json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
            if data is not None
            else None
        )
        if content is not None and len(content) > 65_536:
            raise HikvisionValidationError("Access request exceeds size limit")
        body = await self.client._request(
            method, path, content=content, content_type="application/json"
        )
        return parse_payload(body).data

    async def async_capabilities(self) -> AccessCapabilities:
        users = await self._json("GET", "/ISAPI/AccessControl/UserInfo/capabilities?format=json")
        cards = await self._json("GET", "/ISAPI/AccessControl/CardInfo/capabilities?format=json")
        try:
            mode = await self._json(
                "GET", "/ISAPI/AccessControl/UserAndRight/PwMgrParams?format=json"
            )
        except HikvisionUnsupportedError:
            mode = {}
        self.capabilities = AccessCapabilities.from_payloads(users, cards, mode)
        return self.capabilities

    async def _search(self, kind: str, employee_no: str | None = None) -> list[dict[str, Any]]:
        try:
            return await self._search_pages(kind, employee_no)
        except TimeoutError:
            raise HikvisionTimeoutError("Access inventory deadline exceeded") from None

    async def _search_pages(
        self, kind: str, employee_no: str | None = None
    ) -> list[dict[str, Any]]:
        if employee_no is not None:
            validate_identifier(employee_no)
        cap = self.capabilities
        if cap is None:
            raise HikvisionUnsupportedError("Read access capabilities before searching")
        operation_set = cap.user_operations if kind == "UserInfo" else cap.card_operations
        if "get" not in operation_set:
            raise HikvisionUnsupportedError("Device does not advertise access search")
        maximum = cap.max_users if kind == "UserInfo" else cap.max_cards
        page_size = cap.user_page if kind == "UserInfo" else cap.card_page
        search_id, offset, total = uuid4().hex, 0, None
        seen: set[str] = set()
        records: list[dict[str, Any]] = []
        # A stuck or changing inventory must fail before reconciliation obtains a snapshot.
        async with asyncio.timeout(120):
            for _ in range((maximum + page_size - 1) // page_size + 1):
                condition: dict[str, Any] = {
                    "searchID": search_id,
                    "searchResultPosition": offset,
                    "maxResults": page_size,
                }
                if employee_no is not None:
                    condition["EmployeeNoList"] = [{"employeeNo": employee_no}]
                data = await self._json(
                    "POST",
                    f"/ISAPI/AccessControl/{kind}/Search?format=json",
                    {kind + "SearchCond": condition},
                )
                result = data.get(kind + "Search")
                if not isinstance(result, dict) or result.get("searchID") != search_id:
                    raise HikvisionValidationError("Invalid access search response")
                status = result.get("responseStatusStrg")
                if status not in {"OK", "MORE", "NO MATCH", "NOMATCH"}:
                    raise HikvisionValidationError("Unknown access search status")
                count = _integer(result.get("numOfMatches"), 0, page_size)
                current_total = _integer(result.get("totalMatches"), 0, maximum)
                if total is not None and total != current_total:
                    raise HikvisionConflictError("Device inventory changed during search")
                total = current_total
                items = result.get(kind, [])
                if not isinstance(items, list) or len(items) != count:
                    raise HikvisionValidationError("Access result count does not match records")
                for item in items:
                    if not isinstance(item, dict):
                        raise HikvisionValidationError("Invalid access record")
                    person = validate_identifier(item.get("employeeNo"), maximum=cap.employee_max)
                    key = (
                        person
                        if kind == "UserInfo"
                        else validate_card(
                            item.get("cardNo"), minimum=cap.card_min, maximum=cap.card_max
                        )
                    )
                    if employee_no is not None and person != employee_no:
                        raise HikvisionValidationError("Device ignored the requested person filter")
                    if key in seen:
                        raise HikvisionValidationError("Duplicate or repeated access result")
                    seen.add(key)
                    records.append(item)
                offset += count
                if offset > total:
                    raise HikvisionValidationError("Access search exceeded its reported total")
                if status in {"NO MATCH", "NOMATCH"}:
                    if offset or total:
                        raise HikvisionValidationError("Invalid no-match access response")
                    return []
                if status == "OK":
                    if offset != total:
                        raise HikvisionValidationError(
                            "Device reported an incomplete inventory as complete"
                        )
                    return records
                if count == 0 or offset >= total:
                    raise HikvisionValidationError("Access search made no progress")
        raise HikvisionValidationError("Access pagination limit exceeded")

    async def async_counts(self) -> tuple[int, int]:
        if self.capabilities is None:
            raise HikvisionUnsupportedError("Read capabilities before counts")
        users = await self._json("GET", "/ISAPI/AccessControl/UserInfo/Count?format=json")
        cards = await self._json("GET", "/ISAPI/AccessControl/CardInfo/Count?format=json")
        user, card = users.get("UserInfoCount"), cards.get("CardInfoCount")
        if not isinstance(user, dict) or not isinstance(card, dict):
            raise HikvisionValidationError("Invalid access count response")
        return (
            _integer(user.get("userNumber"), 0, self.capabilities.max_users),
            _integer(card.get("cardNumber"), 0, self.capabilities.max_cards),
        )

    async def async_inventory(self) -> StationInventory:
        users = await self._search("UserInfo")
        cards = await self._search("CardInfo")
        people = {user["employeeNo"] for user in users}
        if any(card["employeeNo"] not in people for card in cards):
            raise HikvisionConflictError("Card references an absent person; rescan required")
        return StationInventory(
            {user["employeeNo"]: user for user in users}, {card["cardNo"]: card for card in cards}
        )

    async def async_person(self, employee_no: str) -> StationInventory:
        users = await self._search("UserInfo", employee_no)
        cards = await self._search("CardInfo", employee_no)
        if len(users) > 1 or (cards and not users):
            raise HikvisionConflictError("Inconsistent person inventory")
        return StationInventory(
            {user["employeeNo"]: user for user in users}, {card["cardNo"]: card for card in cards}
        )

    async def _write(self, kind: str, operation: str, payload: dict[str, Any]) -> None:
        self._require_mutation(
            kind, {"Record": "post", "Modify": "put", "Delete": "delete"}[operation]
        )
        data = await self._json(
            "POST" if operation == "Record" else "PUT",
            f"/ISAPI/AccessControl/{kind}/{operation}?format=json",
            payload,
        )
        codes = find_values(data, "statusCode")
        if not codes or any(str(code) != "1" for code in codes):
            raise HikvisionDeviceError("Access write was not acknowledged")

    async def async_write_person(self, person: dict[str, Any], *, create: bool) -> None:
        cap = self._require_mutation("UserInfo", "post" if create else "put")
        allowed = {
            "employeeNo",
            "name",
            "userType",
            "Valid",
            "doorRight",
            "RightPlan",
            "localUIRight",
        }
        if cap.pin_field:
            allowed.add(cap.pin_field)
        if set(person) - allowed:
            raise HikvisionValidationError("Unmanaged person fields cannot be written")
        validate_identifier(person.get("employeeNo"), maximum=cap.employee_max)
        name = person.get("name")
        if (
            not isinstance(name, str)
            or not 1 <= len(name) <= cap.name_max
            or person.get("userType") not in cap.user_types
        ):
            raise HikvisionValidationError("Person name or type exceeds device capabilities")
        door_right = person.get("doorRight")
        if not isinstance(door_right, str) or door_right not in {
            str(door) for door in self.client.enabled_doors
        }:
            raise HikvisionValidationError("Person permissions target an unmanaged relay")
        # Level A only: station-wide access to the one selected active output.
        if person.get("RightPlan") != [] or person.get("localUIRight") is not False:
            raise HikvisionValidationError(
                "Unverified schedules or local administrator rights are not allowed"
            )
        validity = person.get("Valid")
        if not isinstance(validity, dict) or type(validity.get("enable")) is not bool:
            raise HikvisionValidationError("A valid access period is required")
        try:
            time_type = validity.get("timeType")
            if time_type not in {"local", "UTC"}:
                raise ValueError
            first, last = (
                datetime.fromisoformat(validity["beginTime"]),
                datetime.fromisoformat(validity["endTime"]),
            )
            if (first.tzinfo is not None) != (time_type == "UTC") or (last.tzinfo is not None) != (
                time_type == "UTC"
            ):
                raise ValueError
            if time_type == "UTC":
                first, last = first.astimezone(UTC), last.astimezone(UTC)
            lower = datetime(1970, 1, 1, tzinfo=UTC if time_type == "UTC" else None)
            upper = datetime(2037, 12, 31, 23, 59, 59, tzinfo=UTC if time_type == "UTC" else None)
            if not lower <= first < last <= upper:
                raise ValueError
        except (KeyError, TypeError, ValueError):
            raise HikvisionValidationError("Invalid or unbounded access period") from None
        if cap.pin_field and cap.pin_field in person:
            pin = person[cap.pin_field]
            if not isinstance(pin, str) or (
                pin
                and (
                    not pin.isascii()
                    or not pin.isdecimal()
                    or not cap.pin_min <= len(pin) <= cap.pin_max
                )
            ):
                raise HikvisionValidationError("PIN exceeds device capabilities")
        await self._write("UserInfo", "Record" if create else "Modify", {"UserInfo": person})

    async def async_write_card(
        self, employee_no: str, card_no: str, card_type: str, *, create: bool
    ) -> None:
        cap = self._require_mutation("CardInfo", "post" if create else "put")
        validate_identifier(employee_no, maximum=cap.employee_max)
        validate_card(card_no, minimum=cap.card_min, maximum=cap.card_max)
        if card_type not in cap.card_types:
            raise HikvisionValidationError("Card type is not supported by this station")
        await self._write(
            "CardInfo",
            "Record" if create else "Modify",
            {"CardInfo": {"employeeNo": employee_no, "cardNo": card_no, "cardType": card_type}},
        )

    async def async_delete_card(self, card_no: str) -> None:
        cap = self._require_mutation("CardInfo", "delete")
        validate_card(card_no, minimum=cap.card_min, maximum=cap.card_max)
        # This exact selector is also used by the target's own person editor.
        await self._write(
            "CardInfo", "Delete", {"CardInfoDelCond": {"CardNoList": [{"cardNo": card_no}]}}
        )

    async def async_delete_person(self, employee_no: str) -> None:
        cap = self._require_mutation("UserInfo", "delete")
        validate_identifier(employee_no, maximum=cap.employee_max)
        # Use the separately documented simple delete advertised/used by this firmware.
        # Caller must verify cards and person absent; an acknowledgement is not completion.
        await self._write(
            "UserInfo",
            "Delete",
            {"UserInfoDelCond": {"EmployeeNoList": [{"employeeNo": employee_no}]}},
        )
