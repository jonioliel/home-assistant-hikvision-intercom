"""Reviewed station lifecycle actions; physical I/O is delegated to the existing engine."""

from __future__ import annotations

import asyncio
from contextlib import AsyncExitStack, asynccontextmanager
from copy import deepcopy
from typing import Any

from homeassistant.core import HomeAssistant

from .access import station_lifecycle_jobs as jobs
from .access.models import AccessError, utc_now
from .access.station_lifecycle import impact
from .access_runtime import get_manager
from .configuration import managed_locks
from .const import DOMAIN


async def administrators(hass: HomeAssistant, actors: list[str]) -> None:
    for actor in actors:
        user = await hass.auth.async_get_user(actor)
        if not user or not user.is_active or not user.is_admin:
            raise AccessError("unauthorized")


def metadata(hass: HomeAssistant, source: str, target: str | None) -> dict[str, Any]:
    data = hass.data[DOMAIN]["operations_center"].data
    records = data["stations"]
    return {
        kind: (
            {"revision": data["revision"], "values": deepcopy(records[sid]["values"])}
            if sid and sid in records
            else None
        )
        for kind, sid in (("source", source), ("target", target))
    }


def definition(entry: Any) -> dict[str, Any]:
    runtime = getattr(entry, "runtime_data", None)
    if not runtime or runtime.is_closed:
        raise AccessError("station_unloaded")
    return {
        "id": entry.entry_id,
        "identity": runtime.profile.unique_id,
        "name": entry.title,
        "mappings": [
            {"physical_index": m.physical_index, "api_id": m.api_id, "name": m.name}
            for m in managed_locks(entry.data)
        ],
    }


@asynccontextmanager
async def observed(hass: HomeAssistant, source: str, target: str | None):
    """Keep both write lanes reserved until the reviewed central mutation is committed."""
    manager = get_manager(hass)
    ids = [source, *([target] if target else [])]
    entries, drivers, inventories = {}, {}, {}
    async with AsyncExitStack() as stack:
        for sid in sorted(ids):
            entry = hass.config_entries.async_get_entry(sid)
            station = manager.stations.get(sid)
            if not entry or entry.domain != DOMAIN or not station or not station.driver:
                raise AccessError("station_unloaded")
            if sid in hass.data[DOMAIN].get("technical_busy", set()):
                raise AccessError("device_busy")
            runtime = getattr(entry, "runtime_data", None)
            definition(entry)
            driver = station.driver
            async with asyncio.timeout(30):
                await stack.enter_async_context(driver.transaction())
                await driver.async_capabilities()
                inventories[sid] = await driver.async_inventory()
            entries[sid], drivers[sid] = (entry, runtime), driver
        definitions = [definition(entries[sid][0]) for sid in ids]
        if len({d["identity"] for d in definitions}) != len(definitions):
            raise AccessError("station_identity_duplicate")

        def check():
            if manager._closed:
                raise AccessError("manager_closed")
            for sid in ids:
                entry, runtime = entries[sid]
                if (
                    hass.config_entries.async_get_entry(sid) is not entry
                    or getattr(entry, "runtime_data", None) is not runtime
                    or runtime.is_closed
                    or manager.stations[sid].driver is not drivers[sid]
                ):
                    raise AccessError("bulk_review_stale")
            if [definition(entries[sid][0]) for sid in ids] != definitions:
                raise AccessError("bulk_review_stale")

        check()
        yield definitions, inventories, check


def matching_definitions(row: dict[str, Any], definitions: list[dict[str, Any]]) -> None:
    expected = deepcopy(row["definitions"])
    # A committed copy of the source's display name is idempotent on resume.
    if row["state"] != "prepared" and row["target_id"]:
        if definitions[1]["name"] == expected[0]["name"]:
            expected[1]["name"] = definitions[1]["name"]
    if definitions != expected:
        raise AccessError("bulk_review_stale")


def present(hass: HomeAssistant, row: dict[str, Any], actor: str) -> dict[str, Any]:
    result = jobs.public(row, actor)
    result["require_approval"] = bool(
        row["require_approval"] or hass.data[DOMAIN]["workflows"].settings()["dual_approval"]
    )
    return result


def permission_source_free(state: dict[str, Any], source: str) -> bool:
    return not any(
        source in raw["assignments"] or source in raw["permission_overrides"]
        for raw in state["users"].values()
    ) and not any(
        source in g["station_ids"]
        for g in (state["profile_settings"] or {}).get("values", {}).get("groups", [])
    )


def cleanup_counts(state: dict[str, Any], source: str) -> dict[str, Any]:
    return {
        "bindings": len(state["bindings"].get(source, {})),
        **{
            kind: sum(
                source in value["targets"] and source not in value["confirmed"]
                for value in state[kind].values()
            )
            for kind in ("tombstones", "retired_cards", "retired_pins")
        },
    }


def forget_removed(manager: Any, row: dict[str, Any]) -> None:
    # Ordinary unload retains cancellation rows. This workflow proved cleanup first.
    station = manager.stations.get(row["source_id"])
    if (
        row["state"] == "removed"
        and station is not None
        and station.driver is None
        and not manager.engine.jobs(row["source_id"])
    ):
        manager.stations.pop(row["source_id"])
        manager._changed()


async def copy_metadata(hass: HomeAssistant, row: dict[str, Any]) -> None:
    """Resume harmless metadata stages separately; permission policy is already durable."""
    if row["metadata_applied"]:
        return
    target = row["target_id"]
    if target:
        desired = row["metadata"]["source"]
        current = metadata(hass, row["source_id"], target)

        # Operations records share one revision. After a successful partial copy,
        # that revision changes; compare reviewed content while the write itself
        # still uses the current global revision for compare-and-save.
        def values(record: dict[str, Any] | None) -> dict[str, Any] | None:
            return record["values"] if record else None

        if values(current["source"]) != values(row["metadata"]["source"]):
            raise AccessError("bulk_review_stale")
        if desired and (not current["target"] or current["target"]["values"] != desired["values"]):
            if values(current["target"]) != values(row["metadata"]["target"]):
                raise AccessError("bulk_review_stale")
            ops = hass.data[DOMAIN]["operations_center"]
            await ops.save_record(
                "stations",
                target,
                ops.data["revision"],
                desired["values"],
                row["actor"],
            )
        entry = hass.config_entries.async_get_entry(target)
        if not entry:
            raise AccessError("station_unloaded")
        title = row["definitions"][0]["name"]
        if entry.title not in {row["definitions"][1]["name"], title}:
            raise AccessError("bulk_review_stale")
        if entry.title != title:
            hass.config_entries.async_update_entry(entry, title=title)
        get_manager(hass).stations[target].name = title
    await get_manager(hass).repository.async_lifecycle_mark(
        row["id"], lambda state, record: record.update(metadata_applied=True)
    )


async def dispatch_lifecycle(
    hass: HomeAssistant, command: str, msg: dict[str, Any], actor: str
) -> dict[str, Any]:
    await administrators(hass, [actor])
    manager = get_manager(hass)
    repo = manager.repository
    if command == "platform/lifecycle_jobs":
        return {
            "records": [
                present(hass, row, actor)
                for row in sorted(
                    repo.snapshot()["station_lifecycles"].values(),
                    key=lambda r: r["created_at"],
                    reverse=True,
                )
            ]
        }
    if (
        command not in {"platform/lifecycle_prepare", "platform/lifecycle_plan"}
        and msg.get("confirmed") is not True
    ):
        raise AccessError("confirmation_required")
    async with manager.lifecycle_lock:
        if command == "platform/lifecycle_prepare":
            from .access.models import text_field

            source = text_field(msg["source_id"], 64)
            target = text_field(msg["target_id"], 64, empty=True) or None
            if source == target:
                raise AccessError("invalid_fields")
            stamp = repo.bulk_stamp()
            async with observed(hass, source, target) as (definitions, inventories, check):
                projected = await asyncio.to_thread(
                    impact,
                    repo,
                    source,
                    target,
                    target_locks={m["physical_index"] for m in definitions[-1]["mappings"]}
                    if target
                    else set(),
                    source_inventory=inventories[source],
                    target_inventory=inventories[target] if target else None,
                    hold_programs=len(hass.data[DOMAIN]["hold_programs"].listing(source)),
                )
                if (
                    projected["blockers"]
                    or projected["native_schedules"]
                    or projected["unknown_owners"]
                    or (target and inventories[target].cards)
                ):
                    raise AccessError("lifecycle_blocked")
                if target and hass.data[DOMAIN]["hold_programs"].listing(target):
                    raise AccessError("lifecycle_blocked")
                await administrators(hass, [actor])
                check()
                row = await repo.async_lifecycle_prepare(
                    actor=actor,
                    source=source,
                    target=target,
                    definitions=definitions,
                    metadata=metadata(hass, source, target),
                    require_approval=hass.data[DOMAIN]["workflows"].settings()["dual_approval"],
                    stamp=stamp,
                )
            return {"job": present(hass, row, actor), "impact": projected}
        row = jobs.current(repo.snapshot(), msg["job_id"], msg["fingerprint"])
        if command == "platform/lifecycle_decide":
            row = await repo.async_lifecycle_decide(
                job_id=row["id"],
                actor=actor,
                fingerprint=msg["fingerprint"],
                approve=msg["approve"],
            )
            return {"job": present(hass, row, actor)}
        if command == "platform/lifecycle_remove" and row["state"] == "removed":
            forget_removed(manager, row)
            return {"job": present(hass, row, actor)}
        # Recover only a persisted removal intent after the connection disappeared.
        if (
            command == "platform/lifecycle_remove"
            and row["state"] == "removing"
            and hass.config_entries.async_get_entry(row["source_id"]) is None
        ):
            row = await repo.async_lifecycle_mark(
                row["id"],
                lambda state, record: record.update(state="removed", removed_at=utc_now()),
            )
            forget_removed(manager, row)
            return {"job": present(hass, row, actor)}
        source, target = row["source_id"], row["target_id"]
        read_stamp = repo.bulk_stamp()
        removing = False
        async with observed(hass, source, target) as (definitions, inventories, check):
            matching_definitions(row, definitions)
            if command == "platform/lifecycle_plan":
                if row["state"] != "prepared" or row["stamp"] != repo.bulk_stamp():
                    raise AccessError("bulk_review_stale")
                result = await asyncio.to_thread(
                    impact,
                    repo,
                    source,
                    target,
                    target_locks={m["physical_index"] for m in definitions[-1]["mappings"]}
                    if target
                    else set(),
                    source_inventory=inventories[source],
                    target_inventory=inventories[target] if target else None,
                    hold_programs=len(hass.data[DOMAIN]["hold_programs"].listing(source)),
                )
                await administrators(hass, [actor])
                check()
                if row["stamp"] != repo.bulk_stamp():
                    raise AccessError("bulk_review_stale")
                return {
                    "job": present(hass, row, actor),
                    "impact": {
                        **result,
                        "stations": [
                            {**d, "identity_verified": True, "error": None} for d in definitions
                        ],
                    },
                    "metadata": deepcopy(row["metadata"]),
                }
            if command == "platform/lifecycle_apply":
                if row["state"] == "removed":
                    return {"job": present(hass, row, actor)}
                required = (
                    row["require_approval"]
                    or hass.data[DOMAIN]["workflows"].settings()["dual_approval"]
                )
                actors = [actor, row["actor"]]
                if required:
                    consent = row["approval"]
                    if not consent or not consent["approved"]:
                        raise AccessError("approval_required")
                    actors.append(consent["actor"])
                await administrators(hass, actors)
                if row["state"] == "prepared":
                    if metadata(hass, source, target) != row["metadata"]:
                        raise AccessError("bulk_review_stale")
                    owned = {
                        b["employee_no"]
                        for b in repo.snapshot()["bindings"].get(source, {}).values()
                    }
                    if set(inventories[source].users) - owned or (
                        target and (inventories[target].users or inventories[target].cards)
                    ):
                        raise AccessError("lifecycle_blocked")
                    if any(
                        hass.data[DOMAIN]["hold_programs"].listing(sid)
                        for sid in [source, *([target] if target else [])]
                    ):
                        raise AccessError("lifecycle_blocked")
                check()
                try:
                    row = await repo.async_lifecycle_apply(
                        job_id=row["id"],
                        actor=actor,
                        fingerprint=msg["fingerprint"],
                        target_locks={m["physical_index"] for m in definitions[-1]["mappings"]}
                        if target
                        else set(),
                        validate_user=manager._validate,
                    )
                finally:
                    saved = repo.snapshot()["station_lifecycles"][row["id"]]
                    if saved["state"] == "applied" and not manager._closed:
                        for sid in [source, *([target] if target else [])]:
                            manager.request(sid)
                await administrators(hass, actors)
                check()
                await copy_metadata(hass, row)
                manager._changed()
                return {"job": present(hass, jobs.current(repo.snapshot(), row["id"]), actor)}
            if command not in {"platform/lifecycle_verify", "platform/lifecycle_remove"}:
                raise AccessError("invalid_fields")
            if row["state"] not in {"applied", "verified", "removing"}:
                raise AccessError("lifecycle_not_applied")
            actors = [actor]
            if command == "platform/lifecycle_remove" and (
                row["require_approval"]
                or hass.data[DOMAIN]["workflows"].settings()["dual_approval"]
            ):
                if not row["approval"] or not row["approval"]["approved"]:
                    raise AccessError("approval_required")
                actors += [row["actor"], row["approval"]["actor"]]
            await administrators(hass, actors)
            check()

            def mark(state: dict[str, Any], record: dict[str, Any]):
                if repo.bulk_stamp(state) != read_stamp:
                    raise AccessError("bulk_review_stale")
                counts = cleanup_counts(state, source)
                source_clear = permission_source_free(state, source) and not any(counts.values())
                # Empty fresh inventory proves only the accounts/cards managed by this workflow.
                source_clear = (
                    source_clear and not inventories[source].users and not inventories[source].cards
                )
                target_ready = True
                if target:
                    driver = manager.stations[target].driver
                    target_ready = bool(
                        driver
                        and driver.capabilities
                        and jobs.target_verified(
                            repo, state, record, inventories[target], driver.capabilities
                        )
                    )
                if any(
                    hass.data[DOMAIN]["hold_programs"].listing(sid)
                    for sid in [source, *([target] if target else [])]
                ):
                    raise AccessError("lifecycle_blocked")
                ready = bool(source_clear and target_ready and record["metadata_applied"])
                if not ready and command == "platform/lifecycle_remove":
                    raise AccessError("lifecycle_cleanup_pending")
                record["state"] = (
                    "removing"
                    if ready and command == "platform/lifecycle_remove"
                    else "verified"
                    if ready
                    else "applied"
                )
                record["verified_at"] = utc_now() if ready else None

            row = await repo.async_lifecycle_mark(row["id"], mark)
            counts = cleanup_counts(repo.snapshot(), source)
            removing = row["state"] == "removing"
        if removing:
            # Do not hold a device transaction while the runtime is being unloaded.
            await administrators(hass, actors)
            if not await hass.config_entries.async_remove(source):
                raise AccessError("lifecycle_remove_failed")
            row = await repo.async_lifecycle_mark(
                row["id"],
                lambda state, record: record.update(state="removed", removed_at=utc_now()),
            )
        forget_removed(manager, row)
        manager._changed()
        return {
            "job": present(hass, row, actor),
            "pending_cleanup": counts,
            "managed_access_cleanup_verified": row["state"] in {"verified", "removed"},
            "source_removal_ready": row["state"] == "verified",
            "factory_reset_performed": False,
        }
