"""Derive VMS command field documentation without importing HA or executing source."""

import argparse
import ast
import json
from pathlib import Path
from typing import Any


def assignment(path: Path, name: str) -> ast.expr:
    for node in ast.parse(path.read_text(encoding="utf-8")).body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == name for target in node.targets
        ):
            return node.value
    raise ValueError(f"Missing source assignment: {name}")


def catalog(root: Path) -> dict[str, Any]:
    component = root / "custom_components/hikvision_intercom"
    registry = assignment(component / "websocket.py", "COMMANDS")
    if not isinstance(registry, ast.Dict):
        raise ValueError("Command registry is not a literal dictionary")
    commands = {}
    for key, fields in zip(registry.keys, registry.values, strict=True):
        name = ast.literal_eval(key) if key is not None else None
        if not isinstance(name, str) or not isinstance(fields, ast.Dict):
            raise ValueError("Unrecognized command schema")
        required = {}
        for field, kind in zip(fields.keys, fields.values, strict=True):
            field_name = ast.literal_eval(field) if field is not None else None
            if (
                not isinstance(field_name, str)
                or not isinstance(kind, ast.Name)
                or kind.id not in {"str", "int", "bool", "dict", "list", "float"}
            ):
                raise ValueError("Unrecognized command field type")
            required[field_name] = kind.id
        commands[f"hikvision_intercom/{name}"] = {
            "required": required,
            "optional_common": {"api_contract": "int"},
        }
    return {
        "source": "custom_components/hikvision_intercom/websocket.py:COMMANDS",
        "integration_domain": ast.literal_eval(assignment(component / "const.py", "DOMAIN")),
        "integration_version": ast.literal_eval(assignment(component / "const.py", "VERSION")),
        "api_contract_version": ast.literal_eval(
            assignment(component / "api_contract.py", "API_VERSION")
        ),
        "note": (
            "Source-derived panel command fields only. Every command also requires integer id "
            "and string type. Subscription and audio/TTS use separate handlers. Authorization, "
            "nested schemas, workflow tokens, response shapes, and physical outcomes require "
            "the handoff document and source."
        ),
        "commands": dict(sorted(commands.items())),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    target = root / "docs/integrations/WISKEY_VMS_PANEL_COMMANDS.json"
    generated = catalog(root)
    if args.check:
        if json.loads(target.read_text(encoding="utf-8")) != generated:
            raise SystemExit(
                "VMS command catalog is stale. Run python -m tools.generate_panel_catalog."
            )
    else:
        target.write_text(
            json.dumps(generated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )


if __name__ == "__main__":
    main()
