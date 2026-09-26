"""Offline migration must preserve live access state or refuse before writing."""

import json
from pathlib import Path

import pytest

from tools.migrate_domain_offline import MigrationError, apply_plan, build_plan


def _write(path: Path, key: str, data: dict) -> None:
    path.write_text(json.dumps({"version": 1, "key": key, "data": data}), encoding="utf-8")


def _fixture(root: Path) -> Path:
    storage = root / ".storage"
    storage.mkdir()
    _write(
        storage / "core.config_entries",
        "core.config_entries",
        {
            "entries": [
                {
                    "entry_id": "station-1",
                    "domain": "hikvision_intercom",
                    "unique_id": "serial-1",
                    "data": {"password": "private"},
                },
                {"entry_id": "other", "domain": "sun", "unique_id": "sun", "data": {}},
            ]
        },
    )
    _write(
        storage / "core.entity_registry",
        "core.entity_registry",
        {
            "entities": [
                {
                    "entity_id": "lock.front",
                    "config_entry_id": "station-1",
                    "platform": "hikvision_intercom",
                    "unique_id": "serial-1_door_1",
                },
            ]
        },
    )
    _write(
        storage / "core.device_registry",
        "core.device_registry",
        {
            "devices": [
                {
                    "id": "device-1",
                    "config_entries": ["station-1"],
                    "identifiers": [["hikvision_intercom", "serial-1"]],
                },
            ]
        },
    )
    _write(
        storage / "hikvision_intercom.users",
        "hikvision_intercom.users",
        {"users": [{"pin": "123456"}]},
    )
    return storage


def test_offline_domain_migration_preserves_entries_entities_and_private_store(
    tmp_path: Path,
) -> None:
    storage = _fixture(tmp_path)
    plan = build_plan(tmp_path)
    assert (plan.entries, plan.entities, plan.devices, plan.stores) == (1, 1, 1, 1)
    assert (
        json.loads((storage / "core.config_entries").read_text())["data"]["entries"][0]["domain"]
        == "hikvision_intercom"
    )
    backup = tmp_path / "backup.zip"
    apply_plan(plan, backup)
    assert backup.exists()
    entries = json.loads((storage / "core.config_entries").read_text())["data"]["entries"]
    assert entries[0]["domain"] == "smplwise_access_control"
    assert entries[0]["entry_id"] == "station-1"
    assert entries[0]["data"]["password"] == "private"
    assert entries[1]["domain"] == "sun"
    entities = json.loads((storage / "core.entity_registry").read_text())["data"]["entities"]
    assert entities[0]["entity_id"] == "lock.front"
    assert entities[0]["platform"] == "smplwise_access_control"
    devices = json.loads((storage / "core.device_registry").read_text())["data"]["devices"]
    assert devices[0]["identifiers"] == [["smplwise_access_control", "serial-1"]]
    migrated = json.loads((storage / "smplwise_access_control.users").read_text())
    assert migrated["key"] == "smplwise_access_control.users"
    assert migrated["data"]["users"][0]["pin"] == "123456"
    assert (storage / "hikvision_intercom.users").exists()


def test_ha_2026_9_device_and_repair_registry_shapes(tmp_path: Path) -> None:
    storage = _fixture(tmp_path)
    _write(
        storage / "core.device_registry",
        "core.device_registry",
        {
            "devices": [
                {
                    "id": "device-1",
                    "config_entry_id": "station-1",
                    "identifiers": [["hikvision_intercom", "serial-1"]],
                }
            ],
            "child_devices": [
                {"id": "child-1", "config_entry_id": "station-1", "parent_device_id": "device-1"}
            ],
            "deleted_devices": [
                {
                    "id": "deleted-1",
                    "config_entry_id": None,
                    "domain": "hikvision_intercom",
                    "identifiers": [["hikvision_intercom", "old-serial"]],
                }
            ],
        },
    )
    _write(
        storage / "repairs.issue_registry",
        "repairs.issue_registry",
        {
            "issues": [
                {
                    "domain": "hikvision_intercom",
                    "issue_domain": "hikvision_intercom",
                    "issue_id": "test",
                }
            ]
        },
    )
    plan = build_plan(tmp_path)
    assert (plan.devices, plan.issues) == (2, 1)
    apply_plan(plan, tmp_path / "backup.zip")
    registry = json.loads((storage / "core.device_registry").read_text())["data"]
    assert registry["devices"][0]["identifiers"] == [["smplwise_access_control", "serial-1"]]
    assert registry["devices"][0]["config_entry_id"] == "station-1"
    assert registry["child_devices"][0]["parent_device_id"] == "device-1"
    assert registry["deleted_devices"][0]["domain"] == "smplwise_access_control"
    assert registry["deleted_devices"][0]["identifiers"] == [
        ["smplwise_access_control", "old-serial"]
    ]
    issues = json.loads((storage / "repairs.issue_registry").read_text())["data"]["issues"]
    assert issues[0]["domain"] == "smplwise_access_control"
    assert issues[0]["issue_domain"] == "smplwise_access_control"


def test_preflight_refuses_mixed_domains_or_store_collision(tmp_path: Path) -> None:
    storage = _fixture(tmp_path)
    (storage / "smplwise_access_control.users").write_text("{}", encoding="utf-8")
    with pytest.raises(MigrationError, match="Target store already exists"):
        build_plan(tmp_path)


def test_apply_refuses_source_changed_after_preflight(tmp_path: Path) -> None:
    storage = _fixture(tmp_path)
    plan = build_plan(tmp_path)
    (storage / "core.config_entries").write_text("{}", encoding="utf-8")
    with pytest.raises(MigrationError, match="Source changed after preflight"):
        apply_plan(plan, tmp_path / "backup.zip")
    assert not (storage / "smplwise_access_control.users").exists()
