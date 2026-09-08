"""Allowlisted event records and a bounded, privacy-preserving audit cache."""

from __future__ import annotations

import copy
import hashlib
import hmac
import json
import re
from collections import OrderedDict
from datetime import UTC, datetime, timedelta
from typing import Any

from .exceptions import HikvisionValidationError

# Manufacturer Access Control Event Types, major 0x5 (not linkage/operation codes).
KINDS = {
    1: ("access_granted", "granted", "card"),
    9: ("access_denied", "denied", "card"),
    21: ("door_unlocked", "unknown", "unknown"),
    22: ("door_locked", "unknown", "unknown"),
    25: ("contact_open", "unknown", "unknown"),
    26: ("contact_closed", "unknown", "unknown"),
    92: ("unlock_exception", "unknown", "unknown"),
    148: ("attempt_limit", "denied", "pin"),
    150: ("access_denied", "denied", "pin"),
    181: ("access_granted", "granted", "pin"),
    214: ("unlock_record", "unknown", "unknown"),
    215: ("door_not_opened", "unknown", "unknown"),
    216: ("door_not_closed", "unknown", "unknown"),
    229: ("access_granted", "granted", "pin"),
}
EVENT_TYPES = sorted({"unknown", *(item[0] for item in KINDS.values())})
FIELDS = {
    "id",
    "station_id",
    "timestamp",
    "received_at",
    "time_source",
    "employee_no",
    "person_name",
    "door",
    "api_door",
    "authentication",
    "result",
    "event_type",
    "major",
    "minor",
    "card",
    "recovered",
    "source",
}


def timestamp(value: object) -> datetime | None:
    try:
        if not isinstance(value, str) or len(value) > 40:
            return None
        parsed = datetime.fromisoformat(value)
        return parsed.astimezone(UTC) if parsed.tzinfo is not None else None
    except ValueError:
        return None


def _integer(value: object) -> int | None:
    if type(value) is int and 0 <= value <= 2**63 - 1:
        return value
    if isinstance(value, str) and re.fullmatch(r"[0-9]{1,18}", value):
        return int(value)
    return None


def _text(value: object, maximum: int = 128) -> str | None:
    if isinstance(value, str) and 0 < len(value) <= maximum and all(ord(c) >= 32 for c in value):
        return value
    return None


def normalize_event(
    payload: dict[str, Any],
    station_id: str,
    key: bytes,
    *,
    received: datetime,
    selected_api: int | None,
    historical: bool = False,
    occurrence: int = 0,
) -> dict[str, Any] | None:
    """Drop unrelated heartbeat/video events; never copy raw device fields downstream."""
    outer = payload.get("EventNotificationAlert", payload)
    if not isinstance(outer, dict):
        return None
    row: Any
    if historical:
        row = outer
        major, minor = _integer(row.get("major")), _integer(row.get("minor"))
        when = timestamp(row.get("time"))
    else:
        if outer.get("eventType") != "AccessControllerEvent" or outer.get("eventState") != "active":
            return None
        row = outer.get("AccessControllerEvent")
        if not isinstance(row, dict):
            return None
        major = _integer(row.get("majorEventType"))
        minor = _integer(row.get("subEventType"))
        when = timestamp(outer.get("dateTime"))
    if major is None or minor is None:
        return None
    kind, result, authentication = (
        KINDS.get(minor, ("unknown", "unknown", "unknown"))
        if major == 5
        else ("unknown", "unknown", "unknown")
    )
    if major == 5 and minor == 214:
        authentication = {"card": "card", "password": "pin"}.get(
            str(row.get("unlockType")), "unknown"
        )
    employee = _text(row.get("employeeNoString"), 32)
    if not employee:
        number = _integer(row.get("employeeNo"))
        employee = str(number) if number else _text(row.get("employeeNo"), 32)
    api_door = _integer(row.get("doorNo"))
    api_door = api_door if api_door in {1, 2} else None
    card = _text(row.get("cardNo"), 32)
    masked = ("••••" + card[-4:]) if card and len(card) > 4 else ("••••" if card else None)
    # Event serials wrap; timestamp is part of the key. PIN is never hashed or retained.
    identity = [
        station_id,
        when.isoformat() if when else None,
        major,
        minor,
        _integer(row.get("serialNo")),
        api_door,
        employee,
        card,
    ]
    if when is None and identity[4] is None:
        # No trustworthy event identity: do not collapse distinct unknown-time records.
        identity.append(received.isoformat())
    if historical:
        identity.append(occurrence)
    event_id = hmac.new(key, json.dumps(identity).encode(), hashlib.sha256).hexdigest()
    current = row.get("currentEvent") is True or row.get("currentEvent") == "true"
    recovered = (
        historical
        or not current
        or when is None
        or not -5 <= (received - when).total_seconds() <= 90
    )
    return {
        "id": event_id,
        "station_id": station_id,
        "timestamp": (when or received).isoformat(),
        "received_at": received.isoformat(),
        "time_source": "device" if when else "received",
        "employee_no": employee,
        "person_name": _text(row.get("name")),
        "door": 1 if api_door is not None and api_door == selected_api else None,
        "api_door": api_door,
        "authentication": authentication,
        "result": result,
        "event_type": kind,
        "major": major,
        "minor": minor,
        "card": masked,
        "recovered": recovered,
        "source": "query" if historical else "stream",
    }


class EventCache:
    """At most 5,000 safe records / 30 days. Dedupe survives restarts via stored IDs."""

    def __init__(self, *, limit: int = 5000) -> None:
        self.limit = limit
        self.rows: OrderedDict[str, dict[str, Any]] = OrderedDict()

    def load(self, data: dict[str, Any] | None, now: datetime) -> None:
        if data is None:
            return
        rows = data.get("records")
        if data.get("schema") != 1 or not isinstance(rows, list) or len(rows) > self.limit:
            raise HikvisionValidationError("Invalid audit storage")
        for row in rows:
            if not isinstance(row, dict) or set(row) != FIELDS:
                raise HikvisionValidationError("Invalid audit record")
            if (
                not isinstance(row["id"], str)
                or not re.fullmatch(r"[0-9a-f]{64}", row["id"])
                or row["event_type"] not in {*EVENT_TYPES, "ring"}
                or row["result"] not in {"granted", "denied", "unknown"}
                or row["authentication"] not in {"card", "pin", "unknown"}
                or type(row["recovered"]) is not bool
                or timestamp(row["timestamp"]) is None
                or timestamp(row["received_at"]) is None
                or row["card"] is not None
                and (
                    not isinstance(row["card"], str) or not re.fullmatch(r"••••.{0,4}", row["card"])
                )
            ):
                raise HikvisionValidationError("Invalid audit record")
            for field in ("station_id", "employee_no", "person_name"):
                if row[field] is not None and _text(row[field]) is None:
                    raise HikvisionValidationError("Invalid audit text")
            if row["source"] not in {"stream", "query", "call_status"} or row[
                "time_source"
            ] not in {"device", "received"}:
                raise HikvisionValidationError("Invalid audit source")
            for field in ("major", "minor", "api_door", "door"):
                number = row[field]
                if number is not None and (type(number) is not int or number < 0):
                    raise HikvisionValidationError("Invalid audit number")
            if row["door"] not in {None, 1} or row["api_door"] not in {None, 1, 2}:
                raise HikvisionValidationError("Invalid audit door")
            self.rows[row["id"]] = copy.deepcopy(row)
        self.prune(now)

    def prune(self, now: datetime) -> None:
        cutoff = now - timedelta(days=30)
        for key, row in list(self.rows.items()):
            received = timestamp(row["received_at"])
            if received is None or received < cutoff:
                self.rows.pop(key)
        while len(self.rows) > self.limit:
            self.rows.popitem(last=False)

    def add(self, row: dict[str, Any], now: datetime) -> bool:
        self.prune(now)
        if row["id"] in self.rows:
            return False
        self.rows[row["id"]] = copy.deepcopy(row)
        self.prune(now)
        return True

    def dump(self) -> dict[str, Any]:
        return {"schema": 1, "records": copy.deepcopy(list(self.rows.values()))}

    def latest_access(self, station_ids: set[str], now: datetime) -> dict[str, dict[str, Any]]:
        """Select by event time, not replay arrival; do not infer access from door motion."""
        self.prune(now)
        latest: dict[str, tuple[datetime, dict[str, Any]]] = {}
        for row in self.rows.values():
            station_id = row["station_id"]
            when = timestamp(row["timestamp"])
            if (
                station_id not in station_ids
                or row["event_type"]
                not in {"access_granted", "access_denied", "attempt_limit", "unlock_record"}
                or when is None
                or when > now + timedelta(seconds=5)
            ):
                continue
            if station_id not in latest or when > latest[station_id][0]:
                latest[station_id] = (when, row)
        fields = (
            "timestamp",
            "time_source",
            "person_name",
            "employee_no",
            "authentication",
            "result",
            "event_type",
            "recovered",
            "door",
        )
        return {
            station_id: {field: row[field] for field in fields}
            for station_id, (_, row) in latest.items()
        }

    def query(self, filters: dict[str, Any], now: datetime) -> dict[str, Any]:
        allowed = {
            "station_id",
            "person",
            "result",
            "authentication",
            "door",
            "start",
            "end",
            "limit",
            "before",
        }
        if set(filters) - allowed:
            raise HikvisionValidationError("Invalid event filters")
        limit = filters.get("limit", 100)
        if type(limit) is not int or not 1 <= limit <= 200:
            raise HikvisionValidationError("Invalid event limit")
        for field, values in (
            ("result", {"granted", "denied", "unknown"}),
            ("authentication", {"card", "pin", "unknown"}),
        ):
            if field in filters and (
                not isinstance(filters[field], str) or filters[field] not in values
            ):
                raise HikvisionValidationError("Invalid event filter")
        if "door" in filters and (type(filters["door"]) is not int or filters["door"] != 1):
            raise HikvisionValidationError("Invalid door filter")
        for field in ("station_id", "person", "before"):
            if field in filters and _text(filters[field]) is None:
                raise HikvisionValidationError("Invalid text filter")
        start, end = timestamp(filters.get("start")), timestamp(filters.get("end"))
        if (
            "start" in filters
            and start is None
            or "end" in filters
            and end is None
            or start
            and end
            and start >= end
        ):
            raise HikvisionValidationError("Invalid time filter")
        self.prune(now)
        matches = []
        for row in sorted(
            self.rows.values(),
            key=lambda item: (timestamp(item["timestamp"]) or now, item["id"]),
            reverse=True,
        ):
            when = timestamp(row["timestamp"])
            if when is None or start and when < start or end and when > end:
                continue
            if any(
                field in filters and row[field] != filters[field]
                for field in ("station_id", "result", "authentication", "door")
            ):
                continue
            if (
                "person" in filters
                and filters["person"].casefold()
                not in f"{row['employee_no'] or ''} {row['person_name'] or ''}".casefold()
            ):
                continue
            matches.append(row)
        before = filters.get("before")
        if before:
            index = next((i for i, row in enumerate(matches) if row["id"] == before), None)
            if index is None:
                raise HikvisionValidationError("Event cursor expired")
            matches = matches[index + 1 :]
        page = matches[:limit]
        return {
            "records": copy.deepcopy(page),
            "next": page[-1]["id"] if len(matches) > limit else None,
            "retention_days": 30,
            "capacity": self.limit,
        }
