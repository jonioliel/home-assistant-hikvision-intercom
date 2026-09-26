"""Privacy-safe cached fleet inventory and upgrade readiness reports."""

from __future__ import annotations

import csv
import io
import json
from collections.abc import Iterable, Mapping
from typing import Any


def _ratio(value: object, limit: object) -> int | None:
    if type(value) is not int or type(limit) is not int or limit <= 0:
        return None
    return min(100, round(value * 100 / limit))


def _safe_cell(value: object) -> str:
    text = "" if value is None else str(value)
    return f"'{text}" if text.startswith(("=", "+", "-", "@")) else text


def fleet_inventory(
    stations: Iterable[Mapping[str, Any]],
    diagnostics: Mapping[str, Mapping[str, Any]],
    *,
    generated_at: str,
    integration_version: str,
) -> dict[str, Any]:
    """Build a cached fleet report without device or personal identifiers."""
    rows: list[dict[str, Any]] = []
    for station in stations:
        reference = str(station.get("sync_reference") or "")
        cached = diagnostics.get(reference, {})
        caps = station.get("capabilities")
        caps = caps if isinstance(caps, Mapping) else {}
        users = station.get("user_count")
        cards = station.get("card_count")
        user_use = _ratio(users, caps.get("max_users"))
        card_use = _ratio(cards, caps.get("max_cards"))
        near_capacity = any(value is not None and value >= 80 for value in (user_use, card_use))
        last_error = station.get("last_error")
        rows.append(
            {
                "station_ref": reference,
                "name": str(station.get("name") or ""),
                "model": cached.get("model") or "",
                "firmware": cached.get("firmware") or "",
                "loaded": bool(station.get("loaded")),
                "online": bool(cached.get("online")) if "online" in cached else None,
                "sync_state": str(station.get("sync_state") or "unknown"),
                "last_error": str(last_error) if last_error else None,
                "managed_locks": len(cached.get("managed_locks") or []),
                "managed_users": station.get("managed_user_count"),
                "pending_users": station.get("pending_user_count"),
                "users": users,
                "max_users": caps.get("max_users"),
                "user_utilization_percent": user_use,
                "cards": cards,
                "max_cards": caps.get("max_cards"),
                "card_utilization_percent": card_use,
                "near_capacity": near_capacity,
                "pin_writable": caps.get("pin_writable"),
                "native_schedules": caps.get("schedules"),
                "inventory_sampled_at": station.get("scanned_at"),
                "last_reconciled_at": station.get("reconciled_at"),
            }
        )
    rows.sort(key=lambda row: (row["name"].casefold(), row["station_ref"]))
    return {
        "format": "smplwise_access_control.fleet_inventory",
        "generated_at": generated_at,
        "integration_version": integration_version,
        "scope": "cached_inventory_no_device_reads",
        "privacy": "no_credentials_addresses_user_names_phone_numbers_pins_or_card_numbers",
        "summary": {
            "stations": len(rows),
            "loaded": sum(row["loaded"] for row in rows),
            "online": sum(row["online"] is True for row in rows),
            "offline": sum(row["online"] is False for row in rows),
            "pending_users": sum(row["pending_users"] or 0 for row in rows),
            "near_capacity": sum(row["near_capacity"] for row in rows),
        },
        "stations": rows,
    }


def export_inventory(report: Mapping[str, Any], output_format: str) -> dict[str, str]:
    """Serialize a fleet report for download."""
    if output_format == "json":
        return {
            "filename": "wiskey-fleet-inventory.json",
            "mime_type": "application/json",
            "content": json.dumps(report, ensure_ascii=False, indent=2),
        }
    if output_format != "csv":
        raise ValueError("invalid_format")
    fields = (
        "station_ref",
        "name",
        "model",
        "firmware",
        "loaded",
        "online",
        "sync_state",
        "last_error",
        "managed_locks",
        "managed_users",
        "pending_users",
        "users",
        "max_users",
        "user_utilization_percent",
        "cards",
        "max_cards",
        "card_utilization_percent",
        "near_capacity",
        "pin_writable",
        "native_schedules",
        "inventory_sampled_at",
        "last_reconciled_at",
    )
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for row in report.get("stations", []):
        writer.writerow({key: _safe_cell(row.get(key)) for key in fields})
    return {
        "filename": "wiskey-fleet-inventory.csv",
        "mime_type": "text/csv;charset=utf-8",
        "content": "\ufeff" + stream.getvalue(),
    }


def upgrade_readiness(
    stations: Iterable[Mapping[str, Any]],
    entries: Iterable[Mapping[str, Any]],
    storage: Mapping[str, bool],
    *,
    generated_at: str,
    integration_version: str,
    supported_config_version: int,
    supported_minor_version: int,
) -> dict[str, Any]:
    """Assess cached state before an integration update; never contact a station."""
    station_rows = list(stations)
    entry_rows = list(entries)
    blockers: list[str] = []
    warnings: list[str] = []
    bad_storage = sorted(key for key, available in storage.items() if not available)
    if bad_storage:
        blockers.append("storage_unavailable")
    incompatible = [
        row
        for row in entry_rows
        if row.get("version") != supported_config_version
        or type(row.get("minor_version")) is not int
        or row["minor_version"] > supported_minor_version
    ]
    if incompatible:
        blockers.append("config_schema_unsupported")
    unloaded = sum(not bool(row.get("loaded")) for row in entry_rows)
    if unloaded:
        warnings.append("entries_unloaded")
    offline = sum(
        not bool(station.get("loaded")) or station.get("sync_state") == "offline"
        for station in station_rows
    )
    pending = sum(int(station.get("pending_user_count") or 0) for station in station_rows)
    if offline:
        warnings.append("stations_offline")
    if pending:
        warnings.append("sync_pending")
    checks = [
        {
            "id": "storage",
            "state": "failed" if bad_storage else "passed",
            "count": len(bad_storage),
        },
        {
            "id": "config_schema",
            "state": "failed" if incompatible else "passed",
            "count": len(incompatible),
        },
        {"id": "entries_loaded", "state": "warning" if unloaded else "passed", "count": unloaded},
        {"id": "stations_online", "state": "warning" if offline else "passed", "count": offline},
        {"id": "sync_queue", "state": "warning" if pending else "passed", "count": pending},
    ]
    return {
        "format": "smplwise_access_control.upgrade_readiness",
        "generated_at": generated_at,
        "integration_version": integration_version,
        "scope": "cached_state_no_device_reads",
        "ready": not blockers,
        "blockers": blockers,
        "warnings": warnings,
        "checks": checks,
        "summary": {"stations": len(station_rows), "entries": len(entry_rows)},
        "actions": ["backup_home_assistant", "review_changelog", "run_pending_test_catalog"],
    }
