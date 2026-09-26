"""Offline, fail-closed Home Assistant domain migration for smplwise access control.

Run against a COPY of the HA config first. For a real config, stop HA before --apply.
Never prints credentials, card numbers, user records, or store payloads.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

OLD = "hikvision_intercom"
NEW = "smplwise_access_control"


class MigrationError(ValueError):
    """Preflight failed; no files should be changed."""


@dataclass(frozen=True)
class Plan:
    files: dict[Path, bytes]
    originals: dict[Path, bytes | None]
    entries: int
    entities: int
    devices: int
    stores: int
    issues: int
    old_ids: frozenset[str]


def _json_file(path: Path) -> tuple[dict[str, Any], bytes]:
    try:
        raw = path.read_bytes()
        if len(raw) > 64 * 1024 * 1024:
            raise MigrationError(f"File exceeds 64 MiB: {path.name}")
        data = json.loads(raw)
    except (OSError, ValueError, UnicodeError) as exc:
        raise MigrationError(f"Cannot read valid JSON: {path.name}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("data"), dict):
        raise MigrationError(f"Invalid HA storage envelope: {path.name}")
    return data, raw


def _encode(data: dict[str, Any]) -> bytes:
    return (json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def build_plan(config_dir: Path) -> Plan:
    storage = config_dir / ".storage"
    if not storage.is_dir():
        raise MigrationError(".storage directory not found")
    changes: dict[Path, bytes] = {}
    originals: dict[Path, bytes | None] = {}

    def schedule(path: Path, new_data: dict[str, Any], original: bytes | None) -> None:
        if path in changes:
            raise MigrationError(f"Duplicate target: {path.name}")
        changes[path] = _encode(new_data)
        originals[path] = original

    config_path = storage / "core.config_entries"
    config, raw = _json_file(config_path)
    entries = config["data"].get("entries")
    if not isinstance(entries, list):
        raise MigrationError("Invalid config-entry list")
    if any(isinstance(row, dict) and row.get("domain") == NEW for row in entries):
        raise MigrationError("New domain already has config entries; abort to avoid collision")
    old_entries = [row for row in entries if isinstance(row, dict) and row.get("domain") == OLD]
    if not old_entries:
        raise MigrationError("No old-domain config entries found")
    old_ids = {row.get("entry_id") for row in old_entries}
    if any(not isinstance(value, str) or not value for value in old_ids) or len(old_ids) != len(
        old_entries
    ):
        raise MigrationError("Missing or duplicate legacy entry IDs")
    for row in old_entries:
        row["domain"] = NEW
    schedule(config_path, config, raw)

    entity_path = storage / "core.entity_registry"
    entities_count = 0
    if entity_path.exists():
        entity, raw = _json_file(entity_path)
        rows = entity["data"].get("entities")
        if not isinstance(rows, list):
            raise MigrationError("Invalid entity registry")
        for row in rows:
            if not isinstance(row, dict) or row.get("platform") != OLD:
                continue
            if row.get("config_entry_id") not in old_ids:
                raise MigrationError("Legacy entity belongs to an unknown config entry")
            row["platform"] = NEW
            entities_count += 1
        schedule(entity_path, entity, raw)

    device_path = storage / "core.device_registry"
    devices_count = 0
    if device_path.exists():
        device, raw = _json_file(device_path)
        for group in ("devices", "child_devices", "deleted_devices"):
            rows = device["data"].get(group, [])
            if not isinstance(rows, list):
                raise MigrationError(f"Invalid device registry group: {group}")
            for row in rows:
                if not isinstance(row, dict):
                    raise MigrationError(f"Invalid device registry row: {group}")
                identifiers = row.get("identifiers", [])
                if not isinstance(identifiers, list):
                    raise MigrationError("Invalid device identifiers")
                legacy_entries = row.get("config_entries", [])
                if not isinstance(legacy_entries, list):
                    raise MigrationError("Invalid device config entries")
                # HA 2026.9 stores a singular config_entry_id; older registries
                # used config_entries. Both forms must preserve the same device ID.
                owned = (
                    row.get("config_entry_id") in old_ids
                    or bool(old_ids.intersection(legacy_entries))
                    or (group == "deleted_devices" and row.get("domain") == OLD)
                )
                for identifier in identifiers:
                    if (
                        isinstance(identifier, list)
                        and len(identifier) == 2
                        and identifier[0] == OLD
                    ):
                        if not owned:
                            raise MigrationError(
                                "Legacy device identifier belongs to an unknown entry"
                            )
                        identifier[0] = NEW
                        devices_count += 1
                if owned and row.get("domain") == OLD:
                    row["domain"] = NEW
        schedule(device_path, device, raw)

    issue_path = storage / "repairs.issue_registry"
    issues_count = 0
    if issue_path.exists():
        issue, raw = _json_file(issue_path)
        rows = issue["data"].get("issues")
        if not isinstance(rows, list):
            raise MigrationError("Invalid issue registry")
        for row in rows:
            if isinstance(row, dict) and row.get("domain") == OLD:
                row["domain"] = NEW
                if row.get("issue_domain") == OLD:
                    row["issue_domain"] = NEW
                issues_count += 1
        schedule(issue_path, issue, raw)

    stores_count = 0
    for source in sorted(storage.glob(f"{OLD}.*")):
        if not source.is_file():
            raise MigrationError(f"Unexpected legacy store path: {source.name}")
        target = storage / (NEW + source.name[len(OLD) :])
        if target.exists():
            raise MigrationError(f"Target store already exists: {target.name}")
        envelope, _ = _json_file(source)
        if envelope.get("key") != source.name:
            raise MigrationError(f"Store key mismatch: {source.name}")
        envelope["key"] = target.name
        schedule(target, envelope, None)
        stores_count += 1
    if not stores_count:
        raise MigrationError("No legacy stores found; cannot prove users and permissions migrate")
    return Plan(
        changes,
        originals,
        len(old_entries),
        entities_count,
        devices_count,
        stores_count,
        issues_count,
        frozenset(value for value in old_ids if isinstance(value, str)),
    )


def apply_plan(plan: Plan, backup_path: Path) -> None:
    if backup_path.exists():
        raise MigrationError("Backup path already exists")
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(backup_path, "x", compression=zipfile.ZIP_DEFLATED) as backup:
        for path, original in plan.originals.items():
            if original is not None:
                backup.writestr(path.name, original)
        backup.writestr(
            "SHA256.txt",
            "".join(
                f"{hashlib.sha256(original).hexdigest()}  {path.name}\n"
                for path, original in plan.originals.items()
                if original is not None
            ),
        )
    written: list[Path] = []
    try:
        for path, payload in plan.files.items():
            if plan.originals[path] is None and path.exists():
                raise MigrationError(f"Target appeared after preflight: {path.name}")
            if plan.originals[path] is not None and path.read_bytes() != plan.originals[path]:
                raise MigrationError(f"Source changed after preflight: {path.name}")
            fd, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
            try:
                with os.fdopen(fd, "wb") as handle:
                    handle.write(payload)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(name, path)
            finally:
                if os.path.exists(name):
                    os.unlink(name)
            written.append(path)
            if path.read_bytes() != payload:
                raise MigrationError(f"Post-write verification failed: {path.name}")
    except Exception:
        for path in reversed(written):
            original = plan.originals[path]
            if original is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(original)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "config_dir", type=Path, help="Home Assistant config directory or an offline copy"
    )
    parser.add_argument("--apply", action="store_true", help="Write migrated files after backup")
    parser.add_argument(
        "--ha-stopped", action="store_true", help="Explicitly confirm HA is stopped"
    )
    parser.add_argument("--backup", type=Path, help="Archive path outside .storage")
    args = parser.parse_args()
    try:
        plan = build_plan(args.config_dir)
        summary = {
            "config_entries": plan.entries,
            "entities": plan.entities,
            "device_identifiers": plan.devices,
            "stores": plan.stores,
            "issues": plan.issues,
            "writes": len(plan.files),
        }
        print(json.dumps(summary, ensure_ascii=False))
        if args.apply:
            if not args.ha_stopped:
                raise MigrationError("--apply requires --ha-stopped")
            backup = args.backup or args.config_dir.parent / (
                "smplwise-domain-backup-" + datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ") + ".zip"
            )
            if backup.resolve().is_relative_to((args.config_dir / ".storage").resolve()):
                raise MigrationError("Backup must be outside .storage")
            apply_plan(plan, backup)
            print(json.dumps({"applied": True, "backup": str(backup)}, ensure_ascii=False))
    except MigrationError as exc:
        parser.exit(2, f"Migration refused: {exc}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
