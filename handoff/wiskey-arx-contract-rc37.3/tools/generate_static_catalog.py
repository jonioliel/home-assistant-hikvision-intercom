"""Extract only statically provable WisKey WS metadata without importing HA.

Usage: python tools/generate_static_catalog.py <repository-root> <output-dir>
The generated JSON intentionally marks nested request/response contracts unknown.
"""

from __future__ import annotations

import ast
import json
import sys
from pathlib import Path


def assignments(path: Path) -> dict[str, ast.expr]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return {
        target.id: node.value
        for node in tree.body
        if isinstance(node, (ast.Assign, ast.AnnAssign))
        for target in (node.targets if isinstance(node, ast.Assign) else [node.target])
        if isinstance(target, ast.Name)
    }


def static(node: ast.expr, env: dict[str, object]) -> object:
    if isinstance(node, ast.Name):
        if node.id in {"str", "int", "bool", "dict", "list"}:
            return {"str": str, "int": int, "bool": bool, "dict": dict, "list": list}[node.id]
        return env[node.id]
    if isinstance(node, ast.Dict):
        return {static(k, env): static(v, env) for k, v in zip(node.keys, node.values)}
    if isinstance(node, (ast.Set, ast.List, ast.Tuple)):
        items = [static(item, env) for item in node.elts]
        return set(items) if isinstance(node, ast.Set) else tuple(items) if isinstance(node, ast.Tuple) else items
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "frozenset":
        return frozenset(static(node.args[0], env))
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Sub):
        return static(node.left, env) - static(node.right, env)
    return ast.literal_eval(node)


def resolve(nodes: dict[str, ast.expr]) -> dict[str, object]:
    env: dict[str, object] = {}
    pending = dict(nodes)
    while pending:
        progressed = False
        for name, node in list(pending.items()):
            try:
                env[name] = static(node, env)
            except (KeyError, ValueError, TypeError, SyntaxError):
                continue
            del pending[name]
            progressed = True
        if not progressed:
            break
    return env


def requirements(command: str, p: dict[str, object]) -> list[list[str]] | None:
    special = {
        "search/query": [["users", "view"], ["events", "view"], ["management", "view"]],
        "media/call": [["overview", "view"], ["stations", "view"]],
    }
    if command in special:
        return special[command]
    if command in {
        "overview", "overview/summary", "appearance/settings_get", "security/session",
        "security/touch", "security/lock", "security/reauth_start", "security/reauth_step",
    }:
        return [[area, "view"] for area in ("overview", "users", "events", "stations", "management")]
    if command in {"stations/test_unlock", "media/signal", "tts/engines", "tts/start"}:
        return [["overview", "manage"], ["stations", "manage"]]
    for source, area, level in (
        ("_READ_USERS", "users", "view"), ("_WRITE_USERS", "users", "manage"),
        ("_READ_EVENTS", "events", "view"), ("_WRITE_EVENTS", "events", "manage"),
        ("_READ_STATIONS", "stations", "view"), ("_WRITE_STATIONS", "stations", "manage"),
        ("_READ_MANAGEMENT", "management", "view"),
        ("_WRITE_MANAGEMENT", "management", "manage"),
    ):
        if command in p[source]:
            return [[area, level]]
    return None


def main(repo: Path, out: Path) -> None:
    ws = resolve(assignments(repo / "custom_components/hikvision_intercom/websocket.py"))
    perms = resolve(assignments(repo / "custom_components/hikvision_intercom/panel_permissions.py"))
    api = resolve(assignments(repo / "custom_components/hikvision_intercom/api_contract.py"))
    commands: dict[str, dict[str, type]] = ws["COMMANDS"]  # type: ignore[assignment]
    read = api["READ_COMMANDS"]
    field_commands = perms["FIELD_COMMANDS"]
    optional = {
        "appearance/settings_update": {"accent"},
        "authorization/settings_update": {"station_groups"},
        "authorization/preview": {"station_groups"},
        "visits/list": {"filters"},
        "users/csv_preview": {"column_map"},
        "users/csv_apply": {"column_map"},
        "users/create": {"sync_now"},
        "users/update": {"sync_now"},
        "users/adopt": {"user_id", "revision"},
    }
    catalog = {}
    error_sources: dict[str, set[str]] = {}
    type_map = {str: "string", int: "integer", bool: "boolean", dict: "object", list: "array"}
    for name, fields in sorted(commands.items()):
        required = ["id", "type", *[key for key in fields if key not in optional.get(name, set())]]
        properties = {
            "id": {"type": "integer"},
            "type": {"const": "hikvision_intercom/" + name},
            "api_contract": {"type": "integer", "minimum": 0, "maximum": 1},
        }
        for key, kind in fields.items():
            properties[key] = {"type": type_map[kind]}
        for key in optional.get(name, set()) - set(fields):
            properties[key] = {"type": {"sync_now": "boolean", "revision": "integer"}.get(key, "object" if key in {"filters", "column_map"} else "string")}
        if name in {"users/create", "users/update"}:
            properties["sync_now"]["default"] = True
        special_access = "active-user session endpoint" if name == "authorization/session" else "personal renewal grant may bypass area policy" if name.startswith("renewal/") else None
        catalog[name] = {
            "request": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object", "properties": properties, "required": required,
                "additionalProperties": False,
                "x-completeness": "top-level Voluptuous registration only; nested fields and semantic validators not represented",
            },
            "response": {"x-completeness": "not statically generated; do not use as a validator"},
            "permission": {
                "alternative_area_grants": requirements(name, perms),
                "administrator_only_by_base_mapping": requirements(name, perms) is None and special_access is None,
                "special_access": special_access,
                "station_restricted_surface": name in perms["SCOPED_COMMON_COMMANDS"] or name in perms["SCOPED_STATION_COMMANDS"],
                "field_restricted_surface": name in perms["SCOPED_COMMON_COMMANDS"] or name in perms["FIELD_SCOPED_STATION_COMMANDS"],
                "field_requirement": list(field_commands[name]) if name in field_commands else None,
                "read_command_for_security_guard_and_api_contract": name in read,
            },
            "max_request_bytes": 67_108_864 if name == "backups/preview" else 1_048_576 if name in {
                "users/csv_preview", "users/csv_apply", "users/csv_inspect", "jobs/csv_create"
            } else 65_536,
        }
    for file in (repo / "custom_components/hikvision_intercom").rglob("*.py"):
        tree = ast.parse(file.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not node.args:
                continue
            fn = node.func.id if isinstance(node.func, ast.Name) else node.func.attr if isinstance(node.func, ast.Attribute) else ""
            if fn not in {"AccessError", "AudioError", "IntercomTtsError"}:
                continue
            arg = node.args[0]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                error_sources.setdefault(arg.value, set()).add(f"{file.relative_to(repo).as_posix()}:{node.lineno}")
    out.mkdir(parents=True, exist_ok=True)
    (out / "commands.static.json").write_text(json.dumps({
        "version": "2.0.0-rc.37", "count": len(catalog),
        "warning": "Static source extraction, not full nested request/response schemas. Runtime checks and downstream errors require separate documentation and tests.",
        "commands": catalog,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / "errors.static.json").write_text(json.dumps({
        "version": "2.0.0-rc.37", "count": len(error_sources),
        "warning": "Literal exceptions found in Python source only. Not a command-to-error mapping, complete protocol catalog, or retry guarantee. For mutations, unknown outcomes must never auto-retry.",
        "errors": {key: {"source_locations": sorted(value), "retry": "unclassified", "ui": "show safe localized error and refetch authoritative state; do not auto-retry mutation"} for key, value in sorted(error_sources.items())},
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"commands={len(catalog)} literal_errors={len(error_sources)}")


if __name__ == "__main__":
    main(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve())
