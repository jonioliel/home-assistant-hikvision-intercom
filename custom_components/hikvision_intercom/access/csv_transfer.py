"""Bounded CSV interchange. Exports never contain deployment credentials."""

from __future__ import annotations

import csv
import io
import json
from collections.abc import Iterable, Mapping
from typing import Any

from ..client.access import AccessCapabilities
from ..exceptions import HikvisionValidationError
from ..profile_settings import ID
from .models import AccessError, ManagedUser
from .normalize import desired_cards, desired_person

MAX_CSV_BYTES = 262_144
MAX_CSV_ROWS = 500
COLUMNS = ("employee_no", "display_name", "active", "valid_from", "valid_until", "stations")
IMPORT_COLUMNS = {*COLUMNS, "pin", "cards", "group_ids", "permission_overrides"}


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


def export_users(users: list[ManagedUser], fields: list[str] | None = None) -> str:
    # IDs, not labels, survive renamed fields. Never flatten group access into exceptions.
    keys = sorted(set(fields or []) | {key for user in users for key in user.profile})
    headers = (*COLUMNS, "group_ids", "permission_overrides", *("profile:" + key for key in keys))
    return csv_text(
        headers,
        (
            (
                u.employee_no,
                u.display_name,
                str(u.active).lower(),
                u.valid_from or "CLEAR",
                u.valid_until or "CLEAR",
                "",
                json.dumps(u.group_ids, ensure_ascii=False),
                json.dumps(u.permission_overrides, ensure_ascii=False, sort_keys=True),
                # JSON strings preserve empty values, CLEAR, leading quotes and formula text.
                *(
                    json.dumps(u.profile[key], ensure_ascii=False) if key in u.profile else ""
                    for key in keys
                ),
            )
            for u in sorted(users, key=lambda user: user.employee_no)
        ),
    )


def allowed_column(value: str) -> bool:
    return value in IMPORT_COLUMNS or value.startswith("profile:") and bool(ID.fullmatch(value[8:]))


def _reader(content: str) -> tuple[Any, list[str]]:
    if len(content.encode("utf-8")) > MAX_CSV_BYTES:
        raise AccessError("csv_too_large")
    if "\x00" in content or "\ufffd" in content:
        raise AccessError("csv_invalid_encoding")
    reader = csv.reader(io.StringIO(content.removeprefix("\ufeff"), newline=""), strict=True)
    try:
        headers = next(reader)
    except (csv.Error, StopIteration, UnicodeError):
        raise AccessError("csv_invalid_format") from None
    if (
        not headers
        or len(headers) > 32
        or len(set(headers)) != len(headers)
        or any(not header or len(header) > 128 for header in headers)
    ):
        raise AccessError("csv_invalid_headers")
    return reader, headers


def inspect_csv(content: str) -> dict[str, Any]:
    """Return header metadata only; no identity or credential samples."""
    _reader_obj, headers = _reader(content)
    return {"headers": headers, "mapping": {h: h if allowed_column(h) else "" for h in headers}}


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


def parse_csv(
    content: str, column_map: dict[str, str] | None = None
) -> list[tuple[int, dict[str, str]]]:
    reader, source = _reader(content)
    if column_map is None:
        headers = source
    else:
        if (
            not isinstance(column_map, dict)
            or set(column_map) != set(source)
            or any(not isinstance(value, str) for value in column_map.values())
        ):
            raise AccessError("csv_invalid_headers")
        headers = [column_map[h] for h in source]
    selected = [h for h in headers if h]
    if (
        len(set(selected)) != len(selected)
        or not {"employee_no", "display_name"} <= set(selected)
        or any(not allowed_column(h) for h in selected)
    ):
        raise AccessError("csv_invalid_headers")
    try:
        rows = []
        for row in reader:
            if not row or not any(row):
                continue
            if len(row) != len(headers):
                raise AccessError("csv_invalid_columns")
            rows.append((reader.line_num, {h: v for h, v in zip(headers, row, strict=True) if h}))
            if len(rows) > MAX_CSV_ROWS:
                raise AccessError("csv_too_many_rows")
        if not rows:
            raise AccessError("csv_empty")
        return rows
    except (csv.Error, UnicodeError):
        raise AccessError("csv_invalid_format") from None


def _resolve(key: str, choices: Mapping[str, str], ambiguous: str, missing: str) -> str:
    if key in choices:
        return key
    matches = [sid for sid, name in choices.items() if name == key]
    if len(matches) != 1:
        raise AccessError(ambiguous if len(matches) > 1 else missing)
    return matches[0]


def row_patch(
    row: dict[str, str],
    previous: ManagedUser | None,
    stations: Mapping[str, str],
    policy: dict[str, Any] | None = None,
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
    values = (policy or {}).get("values", {})
    profiles = [key for key in row if key.startswith("profile:") and row[key] != ""]
    if profiles:
        definitions = {field["id"] for field in values.get("fields", [])}
        data["profile"] = dict(previous.profile) if previous else {}
        for column in profiles:
            if column[8:] not in definitions:
                raise AccessError("csv_profile_unknown")
            raw_value = row[column]
            value = _json(raw_value) if raw_value.startswith('"') else raw_value
            if not isinstance(value, str):
                raise AccessError("invalid_fields")
            if raw_value == "CLEAR":
                data["profile"].pop(column[8:], None)
            else:
                data["profile"][column[8:]] = value
    if raw_groups := row.get("group_ids"):
        groups = _json(raw_groups)
        if (
            not isinstance(groups, list)
            or len(groups) > 64
            or any(not isinstance(g, str) for g in groups)
        ):
            raise AccessError("invalid_fields")
        choices = {g["id"]: g["label"] for g in values.get("groups", [])}
        data["group_ids"] = [
            _resolve(g, choices, "csv_group_ambiguous", "csv_group_unknown") for g in groups
        ]
        if len(set(data["group_ids"])) != len(data["group_ids"]):
            raise AccessError("csv_group_ambiguous")
    if raw_overrides := row.get("permission_overrides"):
        if row.get("stations"):
            raise AccessError("csv_permissions_conflict")
        from .group_permissions import overrides

        personal = overrides(_json(raw_overrides))
        resolved = {}
        for key, mode in personal.items():
            target = _resolve(key, stations, "csv_station_ambiguous", "station_not_found")
            if target in resolved:
                raise AccessError("csv_station_ambiguous")
            resolved[target] = mode
        data["permission_overrides"] = resolved
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


def column_errors(
    row: dict[str, str],
    previous: ManagedUser | None,
    stations: Mapping[str, str],
    policy: dict[str, Any] | None,
) -> list[dict[str, str]]:
    """Collect independent cell failures without echoing values or custom source headers."""
    from ..client.access import validate_identifier
    from ..profile_settings import validate_profile
    from .group_permissions import prepare
    from .models import build_user, utc_now

    groups = [
        [key]
        for key in (
            "employee_no",
            "display_name",
            "active",
            "pin",
            "cards",
            "stations",
            "group_ids",
            "permission_overrides",
        )
        if row.get(key)
    ]
    if row.get("valid_from") or row.get("valid_until"):
        groups.append(["valid_from", "valid_until"])
    groups.extend([key] for key in row if key.startswith("profile:") and row[key])
    errors = []
    for columns in groups:
        column = columns[0]
        try:
            single = {
                "employee_no": previous.employee_no if previous else "100000000",
                "display_name": "CSV validation",
            }
            single.update({key: row.get(key, "") for key in columns})
            validate_identifier(single["employee_no"])
            patch = row_patch(single, previous, stations, policy)
            if column.startswith("profile:") and policy:
                key = column[8:]
                definition = [f for f in policy["values"]["fields"] if f["id"] == key]
                values = {key: patch.get("profile", {}).get(key, "")}
                validate_profile(
                    {"values": {"fields": definition}},
                    {"profile": values},
                    {key: previous.profile.get(key, "")} if previous else None,
                )
            build_user(
                prepare(policy, patch, previous),
                employee_no=single["employee_no"],
                now=utc_now(),
                previous=previous,
            )
        except (AccessError, HikvisionValidationError) as err:
            errors.append({"column": column, "code": public_error(err)})
    return errors


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
