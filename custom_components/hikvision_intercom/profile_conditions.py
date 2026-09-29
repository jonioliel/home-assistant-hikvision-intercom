"""Pure conditional-field evaluation; not yet wired into stored policy or UI.

Keep stored values intact. Callers must separately enforce visibility and compare
previous applicability when deciding whether historical data may be retained.
"""

from __future__ import annotations

from typing import Any

from .access.models import AccessError, text_field
from .profile_settings import identifier


def validate_conditions(
    fields: list[dict[str, Any]],
) -> dict[str, dict[str, str] | None]:
    """Validate a bounded graph and return normalized rules without editing inputs."""
    if not isinstance(fields, list) or len(fields) > 12:
        raise AccessError("invalid_fields")
    rules: dict[str, dict[str, str] | None] = {}
    for field in fields:
        if not isinstance(field, dict) or type(field.get("enabled")) is not bool:
            raise AccessError("invalid_fields")
        key = identifier(field.get("id"))
        if key in rules:
            raise AccessError("invalid_fields")
        rule = field.get("depends_on")
        if rule is None:
            rules[key] = None
            continue
        if not isinstance(rule, dict) or set(rule) != {"field_id", "value"}:
            raise AccessError("invalid_fields")
        rules[key] = {
            "field_id": identifier(rule["field_id"]),
            "value": text_field(rule["value"], 100, empty=True),
        }
    visiting: set[str] = set()
    done: set[str] = set()

    def visit(key: str) -> None:
        if key in visiting or key not in rules:
            raise AccessError("invalid_fields")
        if key in done:
            return
        visiting.add(key)
        if rule := rules[key]:
            visit(rule["field_id"])
        visiting.remove(key)
        done.add(key)

    for key in rules:
        visit(key)
    return rules


def resolve_applicability(fields: list[dict[str, Any]], values: dict[str, str]) -> dict[str, bool]:
    """A child applies only when its parent applies and its value matches exactly.

    This evaluates full server-side context. Do not expose hidden parent rules or
    infer applicability from a redacted profile in an operator client.
    """
    rules = validate_conditions(fields)
    if not isinstance(values, dict) or any(not isinstance(v, str) for v in values.values()):
        raise AccessError("invalid_fields")
    definitions = {field["id"]: field for field in fields}
    result: dict[str, bool] = {}

    def evaluate(key: str) -> bool:
        if key not in result:
            active = definitions[key]["enabled"]
            rule = rules[key]
            if active and rule is not None:
                active = (
                    evaluate(rule["field_id"]) and values.get(rule["field_id"], "") == rule["value"]
                )
            result[key] = active
        return result[key]

    for key in rules:
        evaluate(key)
    return result
