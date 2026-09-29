"""Bounded, credential-free diagnostics for explicit field policy reviews."""

from __future__ import annotations

from typing import Any

from ..profile_settings import profile_issue


def signature(field: dict[str, Any]) -> tuple[Any, ...]:
    kind = field.get("type", "text")
    return (
        field["enabled"],
        kind,
        field.get("required", False),
        tuple(field["options"]) if kind == "select" else (),
    )


def changed_definitions(
    prior: dict[str, Any] | None, proposed: dict[str, Any]
) -> list[dict[str, Any]]:
    old = {f["id"]: f for f in (prior or {}).get("values", {}).get("fields", [])}
    rows = []
    for field in proposed["values"]["fields"]:
        before = old.get(field["id"])
        if before is not None and signature(before) == signature(field):
            continue
        # New optional text fields do not impose a constraint on existing people.
        if before is None and (
            not field["enabled"]
            or field.get("type", "text") == "text"
            and not field.get("required", False)
        ):
            continue
        rows.append(
            {"field_id": field["id"], "label": field["label"], "before": before, "after": field}
        )
    return rows


def field_impact(
    prior: dict[str, Any] | None, proposed: dict[str, Any], users: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    """Include archived identities, but never expose raw field values or credentials."""
    rows = changed_definitions(prior, proposed)
    for row in rows:
        missing = invalid = previous_issues = 0
        examples: list[dict[str, Any]] = []
        for raw in users.values():
            value = raw.get("profile", {}).get(row["field_id"], "")
            issue = profile_issue(row["after"], value)
            if row["before"] and profile_issue(row["before"], value):
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
            missing=missing,
            invalid=invalid,
            previous_issues=previous_issues,
            examples=examples,
            examples_truncated=missing + invalid > len(examples),
        )
        row["template_issues"] = sum(
            profile_issue(row["after"], t["profile"].get(row["field_id"], "")) is not None
            for t in proposed["values"].get("templates", [])
            if t["enabled"]
        )
    return rows
