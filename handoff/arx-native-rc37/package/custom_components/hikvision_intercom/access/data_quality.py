"""Read-only data quality over already-authorized projections, never secret records."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from typing import Any

from ..profile_conditions import resolve_applicability
from ..profile_settings import profile_issue
from .models import AccessError, phone_value
from .profile_uniqueness import canonical


def report(
    people: list[dict[str, Any]],
    profiles: dict[str, Any],
    *,
    kind: Any = "all",
    state: Any = "current",
    offset: Any = 0,
    limit: Any = 50,
    snapshot: Any = "",
    permission_context: str = "",
    scoped: bool = False,
) -> dict[str, Any]:
    """Filtering and paging never broaden the projected identity or field scope."""
    if (
        not isinstance(kind, str)
        or kind not in {"all", "missing", "invalid", "duplicate"}
        or not isinstance(state, str)
        or state not in {"all", "current", "archived"}
        or type(offset) is not int
        or not 0 <= offset <= 10_000_000
        or type(limit) is not int
        or not 1 <= limit <= 100
        or not isinstance(snapshot, str)
        or len(snapshot) > 64
        or (offset and not snapshot)
    ):
        raise AccessError("invalid_fields")
    fields = profiles.get("fields", [])
    known = [f for f in fields if not f.get("applicability_unknown")]
    token = hashlib.sha256(
        json.dumps(
            [
                sorted((p["id"], p["revision"]) for p in people),
                profiles.get("revision", 0),
                permission_context,
            ],
            separators=(",", ":"),
            ensure_ascii=True,
        ).encode()
    ).hexdigest()[:24]
    issues: dict[str, list[dict[str, Any]]] = defaultdict(list)
    indexes: dict[tuple[str, str], dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    records = {p["id"]: p for p in people}

    def add(
        uid: str,
        category: str,
        code: str,
        field_id: str = "",
        label: str = "",
        related: list[str] | None = None,
        related_count: int = 0,
    ) -> None:
        item: dict[str, Any] = {
            "kind": category,
            "code": code,
            "field_id": field_id,
            "label": label,
        }
        if related is not None:
            item.update(
                related_ids=related[:10],
                related_count=related_count,
                related_people=[
                    {
                        "id": other,
                        "display_name": records[other]["display_name"],
                        "employee_no": records[other]["employee_no"],
                        "archived": bool(records[other].get("archived_at")),
                    }
                    for other in related[:10]
                ],
            )
        issues[uid].append(item)

    for person in people:
        uid = person["id"]
        name = " ".join(unicodedata.normalize("NFKC", person["display_name"]).casefold().split())
        if name:
            indexes[("display_name", "")][name].append(uid)
        if "phone" not in person.get("redacted_fields", []):
            phone = person.get("phone", "")
            if not phone:
                add(uid, "missing", "missing_phone")
            else:
                try:
                    normalized = phone_value(phone)
                except AccessError:
                    add(uid, "invalid", "invalid_phone")
                else:
                    indexes[("phone", "")][re.sub(r"[^0-9]", "", normalized)].append(uid)
        values = person.get("profile", {})
        applicable = resolve_applicability(known, values)
        for field in known:
            value = values.get(field["id"], "")
            if applicable[field["id"]] and (problem := profile_issue(field, value)):
                add(
                    uid,
                    "missing" if problem == "profile_required" else "invalid",
                    problem,
                    field["id"],
                    field["label"],
                )
            # Retained inactive and archived unique values remain reserved.
            if field["enabled"] and field.get("unique") and value:
                indexes[("profile", field["id"])][canonical(field, value)].append(uid)
    labels = {f["id"]: f["label"] for f in known}
    for (source, field_id), index in indexes.items():
        for owners in index.values():
            if len(owners) < 2:
                continue
            owners = sorted(owners)
            for uid in owners:
                add(
                    uid,
                    "duplicate",
                    "duplicate_" + source,
                    field_id,
                    labels.get(field_id, ""),
                    [other for other in owners[:11] if other != uid][:10],
                    len(owners) - 1,
                )
    counts = Counter(item["kind"] for items in issues.values() for item in items)
    result_rows = []
    for uid in sorted(issues, key=lambda k: (records[k]["display_name"].casefold(), k)):
        person = records[uid]
        archived = bool(person.get("archived_at"))
        selected = [item for item in issues[uid] if kind == "all" or item["kind"] == kind]
        if (
            not selected
            or (state == "archived" and not archived)
            or (state == "current" and archived)
        ):
            continue
        result_rows.append(
            {
                "id": uid,
                "display_name": person["display_name"],
                "employee_no": person["employee_no"],
                "revision": person["revision"],
                "archived": archived,
                "operator_editable": person.get("operator_editable", True),
                "issues": selected,
            }
        )
    stale = bool(snapshot and snapshot != token)
    page = [] if stale else result_rows[offset : offset + limit]
    return {
        "format": "wiskey.people-data-quality.v1",
        "snapshot": token,
        "stale": stale,
        "coverage": {
            "scope": "visible" if scoped else "all",
            "scanned": len(people),
            "archived": sum(bool(p.get("archived_at")) for p in people),
            "unknown_fields": sum(bool(f.get("applicability_unknown")) for f in fields),
        },
        "summary": {
            "people": len(issues),
            "missing": counts["missing"],
            "invalid": counts["invalid"],
            "duplicate": counts["duplicate"],
        },
        "total": len(result_rows),
        "offset": offset,
        "limit": limit,
        "records": page,
        "next_offset": offset + limit if not stale and offset + limit < len(result_rows) else None,
        "previous_offset": max(0, offset - limit) if not stale and offset else None,
        "read_only": True,
    }
