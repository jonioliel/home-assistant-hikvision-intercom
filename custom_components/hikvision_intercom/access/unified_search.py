"""Read-only, bounded search over already-authorized source projections."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from copy import deepcopy
from typing import Any

from .models import AccessError

KINDS = ("people", "events", "actions")


def _text(value: Any, maximum: int = 160) -> str:
    if not isinstance(value, str) or len(value) > maximum or any(ord(c) < 32 for c in value):
        raise AccessError("invalid_fields")
    return unicodedata.normalize("NFKC", value).strip().casefold()


def people_rows(people: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Explicit whitelist; raw credential values and photo data never enter the index."""
    return sorted(
        [
            {
                "id": person["id"],
                "name": person.get("display_name", ""),
                "employee_no": person.get("employee_no", ""),
                "phone": person.get("phone", ""),
                "active": person.get("active", False),
                "archived": bool(person.get("archived_at")),
                "card_suffixes": [
                    card["masked_number"][-4:]
                    for card in person.get("cards", [])
                    if isinstance(card.get("masked_number"), str)
                    and card["masked_number"].startswith("••••")
                ],
            }
            for person in people
        ],
        key=lambda row: (str(row["name"]).casefold(), str(row["employee_no"]), row["id"]),
    )


def event_rows(events: list[dict[str, Any]], stations: dict[str, str]) -> list[dict[str, Any]]:
    fields = (
        "id",
        "station_id",
        "timestamp",
        "received_at",
        "person_name",
        "employee_no",
        "event_type",
        "result",
        "authentication",
        "door",
        "card",
        "source",
        "time_source",
    )
    return [
        {
            **{key: row.get(key) for key in fields},
            "station_name": stations.get(row["station_id"], ""),
        }
        for row in events
    ]


def action_rows(
    actions: list[dict[str, Any]], stations: dict[str, str], actors: dict[str, str]
) -> list[dict[str, Any]]:
    result = []
    for action in actions:
        before, after = action.get("before") or {}, action.get("after") or {}
        result.append(
            {
                "id": str(action["sequence"]),
                "time": action["time"],
                "action": action["action"],
                "actor": action["actor"],
                "actor_name": actors.get(action["actor"], ""),
                "name_before": before.get("display_name", ""),
                "name_after": after.get("display_name", ""),
                "employee_no": after.get("employee_no", before.get("employee_no", "")),
                "fields": list(action["fields"]),
                "stations": [stations.get(sid, "") for sid in action["stations"]],
            }
        )
    return result


def _matches(kind: str, row: dict[str, Any], text: str) -> bool:
    keys = {
        "people": ("name", "employee_no", "phone"),
        "events": (
            "person_name",
            "employee_no",
            "station_name",
            "event_type",
            "result",
            "authentication",
        ),
        "actions": ("name_before", "name_after", "employee_no", "actor_name", "action"),
    }[kind]
    values = [str(row.get(key) or "") for key in keys]
    if kind == "actions":
        values += [str(item) for item in row["fields"] + row["stations"]]
    haystack = unicodedata.normalize("NFKC", " ".join(values)).casefold()
    if all(word in haystack for word in text.split()):
        return True
    if re.fullmatch(r"[+0-9 ()-]+", text):
        digits = re.sub(r"\D", "", text)
        if kind == "people" and len(digits) >= 3 and digits in re.sub(r"\D", "", row["phone"]):
            return True
        suffixes = (
            row.get("card_suffixes", [])
            if kind == "people"
            else [row.get("card") or ""]
            if kind == "events"
            else []
        )
        return len(digits) == 4 and any(str(suffix).endswith(digits) for suffix in suffixes)
    return False


def query(
    sources: dict[str, list[dict[str, Any]] | None],
    *,
    text: Any,
    kind: Any,
    offset: Any,
    limit: Any,
    snapshot: Any,
    permission_context: str = "",
) -> dict[str, Any]:
    """None means forbidden, never zero hidden matches. Counts follow authorization."""
    text = _text(text)
    if not isinstance(kind, str) or kind not in ("all", *KINDS):
        raise AccessError("invalid_fields")
    if type(offset) is not int or not 0 <= offset <= 100_000 or kind == "all" and offset != 0:
        raise AccessError("invalid_fields")
    if type(limit) is not int or not 1 <= limit <= 100:
        raise AccessError("invalid_fields")
    if not isinstance(snapshot, str) or snapshot and not re.fullmatch(r"[0-9a-f]{24}", snapshot):
        raise AccessError("invalid_fields")
    if set(sources) != set(KINDS):
        raise AccessError("invalid_fields")
    if kind != "all" and sources[kind] is None:
        raise AccessError("unauthorized")
    token = hashlib.sha256(
        json.dumps(
            [sources, text, kind, permission_context],
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()[:24]
    stale = bool(snapshot and snapshot != token)
    if stale:
        offset = 0
    sections = {}
    for source in KINDS:
        rows = sources[source]
        matches = [row for row in rows or [] if text and _matches(source, row, text)]
        selected = kind in {"all", source}
        start = offset if kind == source else 0
        shown = (
            matches[start : start + (min(limit, 8) if kind == "all" else limit)] if selected else []
        )
        sections[source] = {
            "available": rows is not None,
            "total": len(matches) if rows is not None else None,
            "records": [
                {key: deepcopy(value) for key, value in row.items() if key != "card_suffixes"}
                for row in shown
            ],
            "next_offset": start + len(shown)
            if selected and start + len(shown) < len(matches)
            else None,
            "previous_offset": max(0, start - limit) if kind == source and start else None,
        }
    return {
        "query": text,
        "kind": kind,
        "offset": offset,
        "limit": limit,
        "snapshot": token,
        "stale": stale,
        "sections": sections,
        "api_contract": 1,
    }
