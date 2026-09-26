"""Protect the existing HACS install path against another domain rename."""

from __future__ import annotations

import json
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXISTING_DOMAIN = "hikvision_intercom"


def test_release_keeps_existing_hacs_integration_path_and_domain() -> None:
    components = ROOT / "custom_components"
    integration_dirs = sorted(
        path.name for path in components.iterdir() if (path / "manifest.json").is_file()
    )
    assert integration_dirs == [EXISTING_DOMAIN]

    manifest = json.loads(
        (components / EXISTING_DOMAIN / "manifest.json").read_text(encoding="utf-8")
    )
    assert manifest["domain"] == EXISTING_DOMAIN
    assert manifest["name"] == "smplwise access control"
    assert manifest["config_flow"] is True

    project = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    assert manifest["version"] == project["project"]["version"]
    package_patterns = project["tool"]["setuptools"]["packages"]["find"]["include"]
    assert "custom_components.hikvision_intercom*" in package_patterns


def test_hacs_display_name_changes_without_changing_existing_storage_namespace() -> None:
    hacs = json.loads((ROOT / "hacs.json").read_text(encoding="utf-8"))
    assert hacs["name"] == "smplwise access control"
    storage = (ROOT / "custom_components" / EXISTING_DOMAIN / "storage.py").read_text(
        encoding="utf-8"
    )
    assert 'key: str = "hikvision_intercom.users"' in storage
