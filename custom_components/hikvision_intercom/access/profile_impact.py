"""Bounded, credential-free diagnostics for explicit field policy reviews."""

from __future__ import annotations

from typing import Any

from ..profile_conditions import resolve_applicability
from ..profile_settings import profile_issue
from .profile_uniqueness import collisions


def signature(field: dict[str, Any]) -> tuple[Any, ...]:
    kind = field.get("type", "text")
    return (
        field["enabled"],
        kind,
        field.get("required", False),
        tuple(field["options"]) if kind == "select" else (),
        field.get("unique", False),
        tuple(sorted((field.get("depends_on") or {}).items())),
    )


def condition_chain(
    field: dict[str, Any], definitions: dict[str, dict[str, Any]]
) -> tuple[Any, ...]:
    """Ancestor activation changes can affect an otherwise unchanged child."""
    rule = field.get("depends_on")
    if not rule:
        return ()
    parent = definitions[rule["field_id"]]
    return (
        rule["field_id"],
        rule["value"],
        parent["enabled"],
        condition_chain(parent, definitions),
    )


def changed_definitions(
    prior: dict[str, Any] | None, proposed: dict[str, Any]
) -> list[dict[str, Any]]:
    old = {f["id"]: f for f in (prior or {}).get("values", {}).get("fields", [])}
    new = {f["id"]: f for f in proposed["values"]["fields"]}
    rows = []
    for field in proposed["values"]["fields"]:
        before = old.get(field["id"])
        if (
            before is not None
            and signature(before) == signature(field)
            and condition_chain(before, old) == condition_chain(field, new)
        ):
            continue
        # New optional text fields do not impose a constraint on existing people.
        if before is None and (
            not field["enabled"]
            or field.get("type", "text") == "text"
            and not field.get("required", False)
            and not field.get("unique", False)
            and not field.get("depends_on")
        ):
            continue
        rows.append(
            {"field_id": field["id"], "label": field["label"], "before": before, "after": field}
        )
    return rows


def field_impact(
    prior: dict[str, Any] | None,
    proposed: dict[str, Any],
    users: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Include archived identities, but never expose raw field values or credentials."""
    rows = changed_definitions(prior, proposed)
    if not rows:
        return []
    duplicates = collisions(proposed, list(users.values()))
    old_fields = (prior or {}).get("values", {}).get("fields", [])
    fields = proposed["values"]["fields"]
    contexts = [
        (
            raw,
            resolve_applicability(old_fields, raw.get("profile", {})),
            resolve_applicability(fields, raw.get("profile", {})),
        )
        for raw in users.values()
    ]
    for row in rows:
        missing = invalid = previous_issues = applicable = newly_applicable = 0
        examples: list[dict[str, Any]] = []
        for raw, before_context, after_context in contexts:
            key = row["field_id"]
            value = raw.get("profile", {}).get(key, "")
            active = after_context[key]
            applicable += active
            newly_applicable += active and not before_context.get(key, False)
            issue = profile_issue(row["after"], value) if active else None
            if row["before"] and before_context.get(key) and profile_issue(row["before"], value):
                previous_issues += 1
            missing += issue == "profile_required"
            invalid += issue == "profile_value_invalid"
            if issue and len(examples) < 20:
                examples.append(
                    {
                        "user_id": raw["id"],
                        "display_name": raw["display_name"],
                        "employee_no": raw["employee_no"],
                        "reason": issue,
                        "archived": raw.get("archived_at") is not None,
                    }
                )
        row.update(
            checked=len(users),
            applicable=applicable,
            inactive=len(users) - applicable,
            newly_applicable=newly_applicable,
            missing=missing,
            invalid=invalid,
            previous_issues=previous_issues,
            examples=examples,
            examples_truncated=missing + invalid > len(examples),
        )
        duplicate_people = duplicates.get(row["field_id"], [])
        row["duplicates"] = len(duplicate_people)
        row["duplicate_examples"] = [
            {
                "user_id": person["id"],
                "display_name": person["display_name"],
                "employee_no": person["employee_no"],
                "archived": person.get("archived_at") is not None,
            }
            for person in duplicate_people[:20]
        ]
        row["duplicate_examples_truncated"] = len(duplicate_people) > 20
        row["template_issues"] = sum(
            profile_issue(row["after"], t["profile"].get(row["field_id"], "")) is not None
            for t in proposed["values"].get("templates", [])
            if t["enabled"] and resolve_applicability(fields, t["profile"])[row["field_id"]]
        )
    return rows
