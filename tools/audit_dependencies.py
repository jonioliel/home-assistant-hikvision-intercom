"""Audit dependencies with narrow, expiring infrastructure compatibility reviews.

Never treats a scan failure as a pass or accepts exceptions for another package,
version, vulnerability, or integration use of the affected cryptography APIs.
See docs/DEPENDENCY_SECURITY_REVIEW.md for the upstream evidence and limits.
"""

from __future__ import annotations

import argparse
import ast
import json
import subprocess
import sys
from datetime import date
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
EXPIRES = date(2026, 10, 31)
REVIEWED = {
    "PYSEC-2026-3554",
    "GHSA-m2h6-j472-rp4c",
    "CVE-2026-69248",
    "PYSEC-2026-3553",
    "GHSA-jwv3-5hgf-82ww",
    "CVE-2026-69249",
    "PYSEC-2026-3552",
    "GHSA-g6cj-pr64-35w5",
    "CVE-2026-69247",
}
ALLOWED_IMPORTS = {
    "cryptography.exceptions": {"InvalidTag", "InvalidSignature"},
    "cryptography.hazmat.primitives.ciphers.aead": {"AESGCM"},
    "cryptography.hazmat.primitives.kdf.scrypt": {"Scrypt"},
    "cryptography.hazmat.primitives.asymmetric.ed25519": {
        "Ed25519PrivateKey",
        "Ed25519PublicKey",
    },
    "cryptography.hazmat.primitives.serialization": {"Encoding", "PublicFormat"},
}


def check_usage(root: Path) -> None:
    """Fail closed when the reviewed direct cryptography usage changes."""
    for path in (root / "custom_components" / "hikvision_intercom").rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8-sig"))):
            if isinstance(node, ast.Import):
                if any(n.name.startswith("cryptography") for n in node.names):
                    raise ValueError("Unreviewed cryptography module import")
            elif isinstance(node, ast.ImportFrom) and (node.module or "").startswith(
                "cryptography"
            ):
                allowed = ALLOWED_IMPORTS.get(node.module or "", set())
                if any(n.name not in allowed for n in node.names):
                    raise ValueError("Unreviewed cryptography API import")


def assess(report: dict[str, Any], root: Path, today: date) -> dict[str, Any]:
    dependencies = report.get("dependencies")
    if not isinstance(dependencies, list) or not dependencies:
        raise ValueError("Dependency audit returned no usable inventory")
    reviewed: list[dict[str, str]] = []
    blocking: list[dict[str, str]] = []
    for dependency in dependencies:
        if not isinstance(dependency, dict):
            raise ValueError("Invalid dependency inventory")
        vulnerabilities = dependency.get("vulns", [])
        if not isinstance(vulnerabilities, list):
            raise ValueError("Invalid vulnerability inventory")
        for vulnerability in vulnerabilities:
            if not isinstance(vulnerability, dict) or not isinstance(vulnerability.get("id"), str):
                raise ValueError("Invalid vulnerability finding")
            row = {
                "package": str(dependency.get("name", "")),
                "version": str(dependency.get("version", "")),
                "id": vulnerability["id"],
            }
            if (
                row["package"] == "cryptography"
                and row["version"] == "48.0.1"
                and row["id"] in REVIEWED
                and today <= EXPIRES
            ):
                reviewed.append(row)
            else:
                blocking.append(row)
    if reviewed:
        manifest = json.loads(
            (root / "custom_components/hikvision_intercom/manifest.json").read_text(
                encoding="utf-8"
            )
        )
        if "cryptography==48.0.1" not in manifest["requirements"]:
            raise ValueError("Reviewed infrastructure dependency pin changed")
        check_usage(root)
    return {
        "state": "blocked" if blocking else "passed_with_reviews" if reviewed else "passed",
        "review_expires": EXPIRES.isoformat(),
        "reviewed_findings": reviewed,
        "blocking_findings": blocking,
        "inventory": report,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        completed = subprocess.run(
            [
                sys.executable,
                "-m",
                "pip_audit",
                "--skip-editable",
                "--progress-spinner",
                "off",
                "-f",
                "json",
            ],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        if completed.returncode not in (0, 1):
            raise ValueError("Dependency scanner failed")
        result = assess(json.loads(completed.stdout), ROOT, date.today())
        if completed.returncode == 1 and not (
            result["reviewed_findings"] or result["blocking_findings"]
        ):
            raise ValueError("Scanner failed without vulnerability findings")
        args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(json.dumps({key: value for key, value in result.items() if key != "inventory"}))
        return 1 if result["blocking_findings"] else 0
    except (ValueError, KeyError, TypeError, OSError, subprocess.TimeoutExpired) as err:
        print(f"Dependency audit blocked: {type(err).__name__}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
