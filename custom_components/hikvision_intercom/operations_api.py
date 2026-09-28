"""Administrator operations, explicit fleet reviews, reports and configuration transport."""

from __future__ import annotations

import asyncio
import hashlib
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any

from homeassistant.core import HomeAssistant

from .access.diagnostics import error_code
from .access.models import AccessError
from .const import DOMAIN
from .operations_center import OperationsCenter, canonical, in_window, retention, webhook_settings


def center(hass: HomeAssistant) -> OperationsCenter:
    value = hass.data[DOMAIN].get("operations_center")
    if not isinstance(value, OperationsCenter):
        raise AccessError("operations_unavailable")
    return value


def station_catalog(hass: HomeAssistant) -> dict[str, str]:
    return {entry.entry_id: entry.title for entry in hass.config_entries.async_entries(DOMAIN)}


def station_stamp(hass: HomeAssistant, ids: list[str]) -> str:
    from .configuration import managed_locks

    rows = []
    for sid in ids:
        entry = hass.config_entries.async_get_entry(sid)
        runtime = getattr(entry, "runtime_data", None) if entry and entry.domain == DOMAIN else None
        if runtime is None or runtime.is_closed:
            raise AccessError("station_unloaded")
        rows.append(
            {
                "id": sid,
                "identity": runtime.profile.unique_id,
                "locks": [(lock.physical_index, lock.api_id) for lock in managed_locks(entry.data)],
            }
        )
    return hashlib.sha256(canonical(rows)).hexdigest()


async def read_configuration(hass: HomeAssistant, sid: str, door: int) -> dict:
    from .client.technical import read_door
    from .configuration import managed_locks

    entry = hass.config_entries.async_get_entry(sid)
    runtime = getattr(entry, "runtime_data", None) if entry and entry.domain == DOMAIN else None
    if runtime is None or runtime.is_closed:
        raise AccessError("station_unloaded")
    if door not in {lock.api_id for lock in managed_locks(entry.data)}:
        raise AccessError("operation_unsupported")
    async with asyncio.timeout(40):
        await runtime.client.async_confirm_identity()
        result = await read_door(runtime.client, door)
    if getattr(entry, "runtime_data", None) is not runtime or runtime.is_closed:
        raise AccessError("station_unloaded")
    return result


async def dispatch_operations(
    hass: HomeAssistant, command: str, msg: dict, actor: str, user: Any
) -> Any:
    if not user or not user.is_active or not user.is_admin:
        raise AccessError("unauthorized")
    ops = center(hass)
    catalog = station_catalog(hass)
    from .event_manager import get_events

    events = get_events(hass)
    now = datetime.now(UTC)
    if command == "platform/get":
        return {**ops.public(actor), "event_usage": usage(events, now), "catalog": catalog}
    if command == "platform/save":
        if msg["collection"] == "stations" and msg["record_id"] not in catalog:
            raise AccessError("station_not_found")
        if msg["collection"] in {"views", "reports"}:
            # Validate group/profile membership and all existing event filter semantics.
            await events.async_report(msg["values"].get("filters", {}))
        return await ops.save_record(
            msg["collection"], msg["record_id"], msg["revision"], msg["values"], actor
        )
    if command == "platform/delete":
        return await ops.delete_record(msg["collection"], msg["record_id"], msg["revision"], actor)
    if command == "platform/config_read":
        ids, door = targets(msg, catalog)
        rows = []
        for sid in ids:
            try:
                rows.append(
                    {
                        "station_id": sid,
                        "name": catalog[sid],
                        "configuration": await read_configuration(hass, sid, door),
                        "error": None,
                    }
                )
            except Exception as err:
                rows.append(
                    {
                        "station_id": sid,
                        "name": catalog[sid],
                        "configuration": None,
                        "error": error_code(err),
                    }
                )
        return {"rows": rows}
    if command == "platform/config_preview":
        ids, door = targets(msg, catalog)
        changes = msg["changes"]
        from .client.technical import FIELDS, validate_changes

        if not isinstance(changes, dict) or not changes or set(changes) - set(FIELDS):
            raise AccessError("invalid_fields")
        rows, pending = [], []
        for sid in ids:
            try:
                observed = await read_configuration(hass, sid, door)
                validate_changes(changes, observed["constraints"])
                metadata = ops.data["stations"].get(sid, {}).get("values")
                allowed = metadata is None or in_window(metadata["window"], now)
                rows.append(
                    {
                        "station_id": sid,
                        "name": catalog[sid],
                        "before": observed["values"],
                        "after": {**observed["values"], **changes},
                        "error": None if allowed else "maintenance_window_closed",
                    }
                )
                if allowed:
                    pending.append(
                        {
                            "station_id": sid,
                            "door": door,
                            "expected": observed["values"],
                            "changes": changes,
                            "identity_stamp": station_stamp(hass, [sid]),
                        }
                    )
            except Exception as err:
                rows.append(
                    {
                        "station_id": sid,
                        "name": catalog[sid],
                        "before": None,
                        "after": None,
                        "error": error_code(err),
                    }
                )
        token = (
            ops.review(
                actor,
                "configuration",
                {"rows": pending},
                station_stamp(hass, [row["station_id"] for row in pending]),
            )
            if pending
            else None
        )
        return {"review_id": token, "rows": rows, "apply_count": len(pending)}
    if command == "platform/config_apply":
        # Existing dual approval does not have a fleet-config change representation.
        # Fail closed rather than silently treating a single operator as two approvers.
        if hass.data[DOMAIN]["workflows"].settings()["dual_approval"]:
            raise AccessError("approval_command_unsupported")
        review = ops.reviews.get(msg["review_id"])
        ids = (
            [row["station_id"] for row in review["values"]["rows"]]
            if review and review["actor"] == actor
            else []
        )
        values = ops.consume(
            actor, msg["review_id"], "configuration", msg["confirmed"], station_stamp(hass, ids)
        )
        from .technical_api import dispatch_technical

        receipts = []
        revision = ops.data["revision"]
        for row in values["rows"]:
            metadata = ops.data["stations"].get(row["station_id"], {}).get("values")
            current = await hass.auth.async_get_user(actor)
            receipt = {
                "at": datetime.now(UTC).isoformat(),
                "station_id": row["station_id"],
                "state": "failed",
                "code": "",
            }
            try:
                if not current or not current.is_active or not current.is_admin:
                    raise AccessError("unauthorized")
                if metadata and not in_window(metadata["window"], datetime.now(UTC)):
                    raise AccessError("maintenance_window_closed")
                if (
                    ops.data["revision"] != revision
                    or station_stamp(hass, [row["station_id"]]) != row["identity_stamp"]
                ):
                    raise AccessError("review_expired")
                await dispatch_technical(
                    hass, "stations/technical_update", {**row, "confirmed": True}
                )
                receipt["state"] = "verified"
            except Exception as err:
                receipt["code"] = error_code(err)
            receipts.append(receipt)
            await ops.append("receipts", receipt)
            from .operations_runtime import publish

            publish(hass, "configuration_result", receipt)
        return {"receipts": receipts}
    if command == "platform/retention_preview":
        policy = retention(msg["values"])
        clone = deepcopy(events.cache)
        before = len(clone.rows)
        clone.configure(policy, now)
        token = ops.review(actor, "retention", {"policy": policy}, event_stamp(events))
        return {
            "review_id": token,
            "before": before,
            "after": len(clone.rows),
            "removed": before - len(clone.rows),
            "values": policy,
        }
    if command == "platform/retention_apply":
        stamp = event_stamp(events)
        values = ops.consume(actor, msg["review_id"], "retention", msg["confirmed"], stamp)
        async with events._save_lock:
            if event_stamp(events) != stamp:
                raise AccessError("review_expired")
            clone = deepcopy(events.cache)
            clone.configure(values["policy"], datetime.now(UTC))
            # Persist records and their policy together. A crash cannot reload a
            # different retention window and prune additional records on startup.
            data = {**events._data(), **clone.dump(), "retention": values["policy"]}
            before_ids = set(events.cache.rows)
            await events.store.async_save(data)
            # Stream ingestion does not take the persistence lock. Merge new arrivals
            # accepted while the snapshot was being written instead of replacing them.
            for identifier, row in events.cache.rows.items():
                if identifier not in before_ids:
                    clone.add(deepcopy(row), datetime.now(UTC))
            events.cache = clone
            events.changed()
        await ops.mutate(
            ops.data["revision"], lambda data: data.__setitem__("retention", values["policy"])
        )
        return usage(events, now)
    if command == "platform/archive":
        from .operations_archive import archive

        return await hass.async_add_executor_job(
            archive,
            deepcopy(list(events.cache.rows.values())),
            msg["month"],
            ops.data["signing_key"],
            now,
        )
    if command == "platform/report":
        source = msg["collection"]
        if source not in {"views", "reports"}:
            raise AccessError("invalid_fields")
        row = ops.data[source].get(msg["record_id"])
        if not row or row["actor"] != actor:
            raise AccessError("record_not_found")
        result = await events.async_report(row["values"]["filters"], export=True, printable=True)
        if source == "reports":
            totals = result["totals"]
            await ops.append(
                "report_runs",
                {
                    "at": now.isoformat(),
                    "actor": actor,
                    "report_id": msg["record_id"],
                    "total": totals["records"],
                    "granted": totals["granted"],
                    "denied": totals["denied"],
                    "code": "",
                },
            )
        return result
    if command == "platform/export":
        return ops.export(catalog)
    if command == "platform/import_preview":
        return ops.import_review(actor, msg["content"], msg["mapping"], set(catalog))
    if command == "platform/import_apply":
        return await ops.import_apply(actor, msg["review_id"], msg["confirmed"], set(catalog))
    if command == "platform/webhook_save":
        values = webhook_settings(msg["values"])
        if msg["confirmed"] is not True:
            raise AccessError("confirmation_required")
        await ops.mutate(msg["revision"], lambda data: data.__setitem__("webhook", values))
        return {"revision": ops.data["revision"], "enabled": values["enabled"]}
    if command == "platform/webhook_key":
        if msg["confirmed"] is not True:
            raise AccessError("confirmation_required")
        return {"key": ops.data["webhook_key"]}
    if command == "platform/integrity":
        result = []
        for key in (
            "access",
            "panel_permissions",
            "appearance_settings",
            "profile_settings",
            "schedule_journal",
            "hold_programs",
            "operations_center",
            "events",
        ):
            value = hass.data[DOMAIN].get(key)
            result.append(
                {
                    "component": key,
                    "state": "available" if value is not None else "unavailable",
                    "remedy": "restore_known_backup_before_restart" if value is None else "none",
                }
            )
        try:
            ops.validate(ops.data)
        except AccessError:
            result.append(
                {
                    "component": "operations_validation",
                    "state": "invalid",
                    "remedy": "restore_known_backup_before_restart",
                }
            )
        return {"checks": result, "writes_performed": False}
    if command == "platform/demo":
        # Synthetic response only; no event ingestion, repository save or device method.
        return {
            "demo": True,
            "stations": [
                {"name": "כניסה לדוגמה", "online": True},
                {"name": "משרד לדוגמה", "online": False},
            ],
            "steps": [
                "review_identity",
                "verify_door_mapping",
                "create_test_person",
                "verify_grant_and_revoke",
                "verify_audio",
                "backup_and_restore",
            ],
            "device_writes": 0,
        }
    raise AccessError("invalid_fields")


def targets(msg: dict, catalog: dict) -> tuple[list[str], int]:
    ids = msg["station_ids"]
    if (
        not isinstance(ids, list)
        or not 1 <= len(ids) <= 12
        or any(not isinstance(sid, str) or sid not in catalog for sid in ids)
        or len(set(ids)) != len(ids)
        or type(msg["door"]) is not int
        or msg["door"] not in {1, 2}
    ):
        raise AccessError("invalid_fields")
    return ids, msg["door"]


def event_stamp(events: Any) -> str:
    return hashlib.sha256(
        canonical(
            {
                "records": list(events.cache.rows),
                "days": events.cache.days,
                "count": events.cache.limit,
                "bytes": events.cache.maximum_bytes,
            }
        )
    ).hexdigest()


def usage(events: Any, now: datetime) -> dict:
    rows = list(events.cache.rows.values())
    days = {}
    for row in rows:
        day = row["received_at"][:10]
        days[day] = days.get(day, 0) + 1
    completed = [count for day, count in days.items() if day != now.strftime("%Y-%m-%d")]
    rate = sum(completed) / len(completed) if completed else None
    return {
        "records": len(rows),
        "bytes": events.cache._bytes,
        "days": events.cache.days,
        "count_limit": events.cache.limit,
        "byte_limit": events.cache.maximum_bytes,
        "observed_records_per_day": round(rate, 1) if rate else None,
        "count_horizon_days": round(events.cache.limit / rate, 1) if rate else None,
        "forecast_basis": "observed_retained_arrival_days",
        "storage_failed": events.storage_failed,
    }
