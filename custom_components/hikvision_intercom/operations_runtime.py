"""Bounded metadata observations, local reports and opt-in signed notifications."""

from __future__ import annotations

import asyncio
import logging
import secrets
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import HomeAssistant
from homeassistant.helpers.event import async_track_time_interval

from .access.models import AccessError
from .const import DOMAIN
from .issues import issue
from .operations_center import OperationsCenter, signed_webhook
from .storage import AccessStore

_LOGGER = logging.getLogger(__name__)


async def async_setup_operations(hass: HomeAssistant) -> None:
    data = hass.data[DOMAIN]
    store = AccessStore(hass, key=f"{DOMAIN}.operations_center")
    ops = OperationsCenter(store.async_save)
    try:
        ops.load(await store.async_load())
        # Persist issuer keys before they may be used for signatures.
        await store.async_save(ops.data)
    except AccessError:
        issue(hass, "operations_storage_corrupt", active=True)
        data["operations_center"] = None
        return
    data["operations_center"] = ops
    from .maintenance_api import setup as setup_maintenance

    await setup_maintenance(hass)
    from .capacity_runtime import setup as setup_capacity

    await setup_capacity(hass)
    issue(hass, "operations_storage_corrupt", active=False)
    queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=100)
    data["operations_notifications"] = queue
    closing = False
    task: asyncio.Task | None = None
    tick_lock = asyncio.Lock()
    issued: dict[str, str] = {}
    observed_probes: dict[str, str] = {}

    async def worker() -> None:
        # One attempt per queued event, no redirects/retries after an uncertain send.
        import httpx

        async with httpx.AsyncClient(timeout=10, follow_redirects=False, trust_env=False) as client:
            while not closing:
                row = await queue.get()
                try:
                    config = ops.data["webhook"]
                    if (
                        not config["enabled"]
                        or row["kind"] not in config["kinds"]
                        or row["url"] != config["url"]
                        or row["revision"] != ops.data["revision"]
                    ):
                        continue
                    payload, headers = signed_webhook(
                        ops.data["webhook_key"],
                        row["kind"],
                        row["values"],
                        event_id=row["id"],
                        at=row["at"],
                    )
                    response = await client.post(config["url"], content=payload, headers=headers)
                    code = "delivered" if 200 <= response.status_code < 300 else "http_rejected"
                    await ops.append(
                        "journal",
                        {
                            "at": datetime.now(UTC).isoformat(),
                            "actor": "",
                            "command": "webhook",
                            "code": code,
                        },
                    )
                except asyncio.CancelledError:
                    raise
                except Exception:
                    _LOGGER.warning(
                        "Configured notification failed; destination and payload omitted"
                    )
                finally:
                    queue.task_done()

    task = hass.async_create_background_task(
        worker(), "smplwise configured notifications", eager_start=False
    )

    async def tick(_now: Any) -> None:
        nonlocal task
        if closing or tick_lock.locked():
            return
        async with tick_lock:
            if task is None:
                task = hass.async_create_background_task(
                    worker(), "smplwise configured notifications", eager_start=False
                )
            from .event_manager import get_events

            now = datetime.now(UTC)
            from .capacity_runtime import observe as observe_capacity

            try:
                await observe_capacity(hass)
            except Exception:
                _LOGGER.warning("Capacity history could not be saved; inventory details omitted")
            for identifier, row in list(ops.data["reports"].items()):
                value = row["values"]
                local = now.astimezone(ZoneInfo(value["timezone"]))
                day = local.strftime("%Y-%m-%d")
                previous = next(
                    (
                        run["at"]
                        for run in reversed(ops.data["report_runs"])
                        if run["report_id"] == identifier and not run["code"]
                    ),
                    None,
                )
                if (
                    not value["enabled"]
                    or local.weekday() not in value["days"]
                    or local.hour != value["hour"]
                    or issued.get(identifier) == day
                    or previous
                    and datetime.fromisoformat(previous)
                    .astimezone(local.tzinfo)
                    .strftime("%Y-%m-%d")
                    == day
                ):
                    continue
                actor = await hass.auth.async_get_user(row["actor"])
                if not actor or not actor.is_active or not actor.is_admin:
                    continue
                issued[identifier] = day
                try:
                    result = await get_events(hass).async_report(value["filters"])
                    totals = result["totals"]
                    run = {
                        "at": now.isoformat(),
                        "actor": row["actor"],
                        "report_id": identifier,
                        "total": totals["records"],
                        "granted": totals["granted"],
                        "denied": totals["denied"],
                        "code": "",
                    }
                except Exception:
                    run = {
                        "at": now.isoformat(),
                        "actor": row["actor"],
                        "report_id": identifier,
                        "total": 0,
                        "granted": 0,
                        "denied": 0,
                        "code": "report_failed",
                    }
                await ops.append("report_runs", run)
            # Cached metadata only: no stream is opened or recorded by this observer.
            for sid, cached in list(data.get("media_evidence", {}).items()):
                runtime, evidence = cached
                entry = hass.config_entries.async_get_entry(sid)
                if (
                    not entry
                    or getattr(entry, "runtime_data", None) is not runtime
                    or runtime.is_closed
                ):
                    continue
                checked = evidence.get("checked_at", "") if evidence else ""
                if not checked or observed_probes.get(sid) == checked:
                    continue
                observed = {
                    "at": checked,
                    "station_id": sid,
                    "source": "cached_probe",
                    "state": "failed" if evidence.get("errors") else "observed",
                    "rtt_ms": None,
                }
                await ops.append("observations", observed)
                observed_probes[sid] = checked

    cancel_timer = async_track_time_interval(hass, tick, timedelta(minutes=5))

    async def stop(_event: Any) -> None:
        nonlocal closing
        closing = True
        cancel_timer()
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        data.pop("operations_notifications", None)

    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, stop)


def publish(hass: HomeAssistant, kind: str, values: dict) -> None:
    ops = hass.data[DOMAIN].get("operations_center")
    if not isinstance(ops, OperationsCenter):
        return
    # The public event bus receives the exact same nonpersonal allowlist as webhook.
    import json

    from .operations_center import signed_webhook

    at = datetime.now(UTC).isoformat()
    identifier = secrets.token_hex(16)
    payload, _ = signed_webhook(ops.data["webhook_key"], kind, values, event_id=identifier, at=at)
    projected = json.loads(payload)["values"]
    hass.bus.async_fire(
        f"{DOMAIN}_operations_event",
        {"version": 1, "kind": kind, "at": at, "id": identifier, "values": projected},
    )
    config = ops.data["webhook"]
    queue = hass.data[DOMAIN].get("operations_notifications")
    if config["enabled"] and kind in config["kinds"] and queue is not None:
        try:
            queue.put_nowait(
                {
                    "kind": kind,
                    "values": projected,
                    "id": identifier,
                    "at": at,
                    "url": config["url"],
                    "revision": ops.data["revision"],
                }
            )
        except asyncio.QueueFull:
            _LOGGER.warning("Configured notification queue full; event payload omitted")


async def audit_denial(hass: HomeAssistant, actor: str, command: str, code: str) -> None:
    ops = hass.data[DOMAIN].get("operations_center")
    if not isinstance(ops, OperationsCenter) or code not in {
        "unauthorized",
        "rate_limited",
        "screen_locked",
        "reauth_required",
        "request_too_large",
        "invalid_fields",
    }:
        return
    # The rejection is still enforced when audit traffic exceeds the disk budget.
    # Bound persistence and notification work to 60 samples per minute globally.
    audit_budget = hass.data[DOMAIN].get("operations_audit_budget", (0.0, 0))
    now = time.monotonic()
    start, count = audit_budget if now - audit_budget[0] < 60 else (now, 0)
    if count >= 60:
        return
    hass.data[DOMAIN]["operations_audit_budget"] = (start, count + 1)
    try:
        # Only registered command names and fixed rejection codes, never msg or exception text.
        await ops.append(
            "journal",
            {
                "at": datetime.now(UTC).isoformat(),
                "actor": actor[:128],
                "command": command[:128],
                "code": code,
            },
        )
        publish(hass, "security_denied", {"command": command, "code": code})
    except Exception:
        _LOGGER.warning("Security rejection could not be persisted; request payload omitted")
