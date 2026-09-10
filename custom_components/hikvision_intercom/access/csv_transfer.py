"""Bounded CSV interchange. Exports never contain deployment credentials."""

from __future__ import annotations

import csv
import io
import json
from collections.abc import Iterable, Mapping
from typing import Any

from ..client.access import AccessCapabilities
from ..exceptions import HikvisionValidationError
from .models import AccessError, ManagedUser
from .normalize import desired_cards, desired_person

MAX_CSV_BYTES = 262_144
MAX_CSV_ROWS = 500
COLUMNS = ("employee_no", "display_name", "active", "valid_from", "valid_until", "stations")
IMPORT_COLUMNS = {*COLUMNS, "pin", "cards"}


def csv_text(headers: Iterable[str], rows: Iterable[Iterable[Any]]) -> str:
    """Quote all cells and neutralize spreadsheet formulas, including leading whitespace."""
    stream = io.StringIO(newline="")
    stream.write("\ufeff")
    writer = csv.writer(stream, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
    writer.writerow(headers)
    for row in rows:
        values = [str(value) if value is not None else "" for value in row]
        writer.writerow(
            [
                "'" + value
                if value.lstrip().startswith(("=", "+", "-", "@"))
                or value.startswith(("\t", "\r", "\n"))
                else value
                for value in values
            ]
        )
    return stream.getvalue()


def export_users(users: list[ManagedUser]) -> str:
    return csv_text(
        COLUMNS,
        (
            (
                u.employee_no,
                u.display_name,
                str(u.active).lower(),
                u.valid_from or "CLEAR",
                u.valid_until or "CLEAR",
                json.dumps(
                    {key: a.enabled for key, a in u.assignments.items()},
                    ensure_ascii=False,
                    sort_keys=True,
                ),
            )
            for u in sorted(users, key=lambda user: user.employee_no)
        ),
    )


def _object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise AccessError("csv_invalid_json")
        result[key] = value
    return result


def _json(value: str) -> Any:
    try:
        return json.loads(value, object_pairs_hook=_object)
    except (ValueError, RecursionError):
        raise AccessError("csv_invalid_json") from None


def parse_csv(content: str) -> list[tuple[int, dict[str, str]]]:
    if len(content.encode("utf-8")) > MAX_CSV_BYTES:
        raise AccessError("csv_too_large")
    if "\x00" in content or "\ufffd" in content:
        raise AccessError("csv_invalid_encoding")
    try:
        reader = csv.reader(io.StringIO(content.removeprefix("\ufeff"), newline=""), strict=True)
        headers = next(reader)
        if (
            len(set(headers)) != len(headers)
            or not {"employee_no", "display_name"} <= set(headers)
            or set(headers) - IMPORT_COLUMNS
        ):
            raise AccessError("csv_invalid_headers")
        rows = []
        for row in reader:
            if not row or not any(row):
                continue
            if len(row) != len(headers):
                raise AccessError("csv_invalid_columns")
            rows.append((reader.line_num, dict(zip(headers, row, strict=True))))
            if len(rows) > MAX_CSV_ROWS:
                raise AccessError("csv_too_many_rows")
        if not rows:
            raise AccessError("csv_empty")
        return rows
    except (csv.Error, StopIteration, UnicodeError):
        raise AccessError("csv_invalid_format") from None


def row_patch(
    row: dict[str, str], previous: ManagedUser | None, stations: Mapping[str, str]
) -> dict[str, Any]:
    data: dict[str, Any] = {key: row[key] for key in ("employee_no", "display_name")}
    if active := row.get("active"):
        if active not in {"true", "false"}:
            raise AccessError("invalid_boolean")
        data["active"] = active == "true"
    first, last = row.get("valid_from", ""), row.get("valid_until", "")
    if first or last:
        if not first or not last or (first == "CLEAR") != (last == "CLEAR"):
            raise AccessError("invalid_validity")
        data.update(
            valid_from=None if first == "CLEAR" else first,
            valid_until=None if last == "CLEAR" else last,
        )
    if pin := row.get("pin"):
        data["pin"] = None if pin == "CLEAR" else pin
    if cards := row.get("cards"):
        numbers = _json(cards)
        if (
            not isinstance(numbers, list)
            or len(numbers) > 255
            or any(not isinstance(number, str) for number in numbers)
        ):
            raise AccessError("invalid_cards")
        old = {card.card_no.value: card.id for card in previous.cards} if previous else {}
        data["cards"] = [
            {"card_no": number, **({"id": old[number]} if number in old else {})}
            for number in numbers
        ]
    if targets := row.get("stations"):
        mapping = _json(targets)
        if not isinstance(mapping, dict) or len(mapping) > 100:
            raise AccessError("invalid_assignments")
        assigned = {}
        for key, enabled in mapping.items():
            if type(enabled) is not bool:
                raise AccessError("invalid_boolean")
            matches = [sid for sid, name in stations.items() if name == key]
            station = key if key in stations else matches[0] if len(matches) == 1 else None
            if station is None:
                raise AccessError(
                    "csv_station_ambiguous" if len(matches) > 1 else "station_not_found"
                )
            if station in assigned:
                raise AccessError("csv_station_ambiguous")
            assigned[station] = {"enabled": enabled, "allowed_locks": [1]}
        data["assignments"] = assigned
    return data


def desired_fields(user: ManagedUser) -> dict[str, Any]:
    data = user.private()
    return {
        key: (
            {
                sid: {
                    field: item[field]
                    for field in ("enabled", "allowed_locks", "schedule_template")
                }
                for sid, item in value.items()
            }
            if key == "assignments"
            else value
        )
        for key, value in data.items()
        if key
        not in {
            "id",
            "revision",
            "created_at",
            "updated_at",
            "identity_locked",
            "profile",
            "group_ids",
            "permission_overrides",
            "photo",
        }
    }


def public_error(error: Exception) -> str:
    if isinstance(error, AccessError):
        return error.code
    if isinstance(error, HikvisionValidationError):
        return "invalid_identifier"
    return "csv_invalid_format"


# Name, active-lock eligibility, selected API door, immutable observed capabilities.
CsvRules = dict[str, tuple[str, bool, int | None, AccessCapabilities | None]]


def validate_csv_targets(user: ManagedUser, rules: CsvRules) -> None:
    for key, assignment in user.assignments.items():
        if key not in rules:
            raise AccessError("station_not_found")
        if not user.active or not assignment.enabled:
            continue
        _name, enabled, api_id, caps = rules[key]
        if not enabled:
            raise AccessError("station_has_no_managed_lock")
        if caps is not None and api_id is not None:
            desired_person(user, api_id, caps)
            desired_cards(user, caps)
