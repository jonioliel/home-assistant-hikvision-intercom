import csv
import io
import json

from custom_components.hikvision_intercom.access.operational_readiness import (
    export_inventory,
    fleet_inventory,
    upgrade_readiness,
)


def station(**changes):
    value = {
        "sync_reference": "abc123def456",
        "name": "Main gate",
        "loaded": True,
        "sync_state": "synced",
        "last_error": None,
        "managed_user_count": 80,
        "pending_user_count": 0,
        "user_count": 80,
        "card_count": 20,
        "scanned_at": "2026-09-23T10:00:00Z",
        "reconciled_at": "2026-09-23T10:01:00Z",
        "capabilities": {
            "max_users": 100,
            "max_cards": 200,
            "pin_writable": True,
            "schedules": False,
        },
    }
    value.update(changes)
    return value


def test_fleet_inventory_is_cached_capacity_aware_and_private():
    report = fleet_inventory(
        [station()],
        {
            "abc123def456": {
                "model": "DS-KV6124-E1",
                "firmware": "V3.9.0",
                "online": True,
                "managed_locks": [1],
            }
        },
        generated_at="2026-09-23T10:02:00Z",
        integration_version="1.9.1",
    )
    row = report["stations"][0]
    assert row["user_utilization_percent"] == 80
    assert row["card_utilization_percent"] == 10
    assert row["near_capacity"] is True
    assert report["summary"] == {
        "stations": 1,
        "loaded": 1,
        "online": 1,
        "offline": 0,
        "pending_users": 0,
        "near_capacity": 1,
    }
    encoded = json.dumps(report)
    for private in (
        "192.0.2.10",
        "demo-secret",
        "123456",
        "987654321",
        "private-employee",
    ):
        assert private not in encoded


def test_fleet_csv_prevents_spreadsheet_formula_injection():
    report = fleet_inventory(
        [station(name="=WEBSERVICE(\"https://invalid\")")],
        {},
        generated_at="2026-09-23T10:02:00Z",
        integration_version="1.9.1",
    )
    exported = export_inventory(report, "csv")
    rows = list(csv.DictReader(io.StringIO(exported["content"].lstrip("\ufeff"))))
    assert rows[0]["name"].startswith("'=")
    assert exported["filename"] == "wiskey-fleet-inventory.csv"


def test_upgrade_readiness_distinguishes_blockers_from_warnings():
    report = upgrade_readiness(
        [station(loaded=False, sync_state="offline", pending_user_count=2)],
        [{"loaded": False, "version": 1, "minor_version": 2}],
        {"access": True, "schedules": True},
        generated_at="2026-09-23T10:02:00Z",
        integration_version="1.9.1",
        supported_config_version=1,
        supported_minor_version=2,
    )
    assert report["ready"] is True
    assert report["blockers"] == []
    assert set(report["warnings"]) == {"entries_unloaded", "stations_offline", "sync_pending"}


def test_upgrade_readiness_blocks_corrupt_storage_and_future_schema():
    report = upgrade_readiness(
        [],
        [{"loaded": True, "version": 1, "minor_version": 9}],
        {"access": True, "schedules": False},
        generated_at="2026-09-23T10:02:00Z",
        integration_version="1.9.1",
        supported_config_version=1,
        supported_minor_version=2,
    )
    assert report["ready"] is False
    assert report["blockers"] == ["storage_unavailable", "config_schema_unsupported"]
