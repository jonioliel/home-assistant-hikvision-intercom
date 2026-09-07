"""Validate release metadata before the CI-gated GitHub publish step."""

import json
import os
import re
import tomllib
from pathlib import Path


def release_metadata(root: Path) -> tuple[str, str]:
    """An Unreleased entry or mismatched version cannot become a release."""
    manifest = json.loads(
        (root / "custom_components/hikvision_intercom/manifest.json").read_text(encoding="utf-8")
    )
    project = tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8"))
    version = manifest["version"]
    if not isinstance(version, str) or not re.fullmatch(
        r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.[1-9]\d*)?",
        version,
    ):
        raise ValueError("Invalid release Semantic Version")
    if project["project"]["version"] != version:
        raise ValueError("Manifest and project versions differ")
    changelog = (root / "CHANGELOG.md").read_text(encoding="utf-8")
    match = re.search(
        rf"^## \[{re.escape(version)}\][^\n]*\n(.*?)(?=^## |\Z)",
        changelog,
        re.MULTILINE | re.DOTALL,
    )
    if not match or not match.group(1).strip():
        raise ValueError("A dedicated, nonempty versioned changelog entry is required")
    return version, match.group(1).strip() + "\n"


def main() -> None:
    """Write reviewed notes and safe step outputs; publishing occurs in the workflow."""
    root = Path(__file__).resolve().parents[1]
    version, notes = release_metadata(root)
    (root / "release-notes.md").write_text(notes, encoding="utf-8")
    prerelease = str(version.startswith("0.") or "-" in version).lower()
    if output := os.environ.get("GITHUB_OUTPUT"):
        with Path(output).open("a", encoding="utf-8") as stream:
            stream.write(f"tag=v{version}\nprerelease={prerelease}\n")
    print(f"Validated v{version}")


if __name__ == "__main__":
    main()
