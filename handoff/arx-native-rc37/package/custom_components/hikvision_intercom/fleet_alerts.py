"""Observational fleet warnings and durable, expiring suppression; never device I/O."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import Any

from .access.models import AccessError, text_field

KINDS = {"offline", "sync_stalled", "sync_conflict", "sync_error", "event_gap", "clock_drift"}
REASONS = {"planned_maintenance", "network_work", "investigating"}
DURATIONS = {15, 60, 240, 1440, 10080}
MAX_SUPPRESSIONS = 5000


def stamp(value: Any) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value)
        return parsed.astimezone(UTC) if parsed.tzinfo else None
    except (TypeError, ValueError, OverflowError):
        return None


def live(row: dict[str, Any], now: datetime) -> bool:
    until = stamp(row.get("until"))
    return until is not None and until > now


def onset(
    rows: list[dict[str, Any]], predicate: Callable[[dict[str, Any]], bool], now: datetime
) -> datetime | None:
    """First observed time in the current contiguous run, not an inferred outage start."""
    start = None
    for row in reversed(rows):
        observed = stamp(row.get("at"))
        if observed is None or observed > now:
            continue
        if not predicate(row):
            break
        start = observed
    return start


def observed_alerts(
    stations: list[dict[str, Any]],
    history: dict[str, list[dict[str, Any]]],
    now: datetime,
    thresholds: dict[str, dict[str, int]] | None = None,
) -> list[dict[str, Any]]:
    alerts: list[dict[str, Any]] = []
    for station in stations:
        sid = station["id"]
        rows = history.get(sid, [])
        limits = (thresholds or {}).get(sid, {})
        online = station.get("online") is True
        status = station.get("sync_state", "unknown")

        def add(
            kind: str,
            since: datetime | None,
            threshold: int = 0,
            severity: str = "warning",
            *,
            sid: str = sid,
            station: dict[str, Any] = station,
            online: bool = online,
            status: str = status,
        ) -> None:
            seconds = max(0, int((now - since).total_seconds())) if since else None
            if threshold and (seconds is None or seconds < threshold):
                return
            alerts.append(
                {
                    "id": f"{sid}/{kind}",
                    "station_id": sid,
                    "station_name": station.get("name", ""),
                    "kind": kind,
                    "severity": severity,
                    "observed_since": since.isoformat() if since else None,
                    "observed_seconds": seconds,
                    "online": online,
                    "sync_state": status,
                }
            )

        if not online:
            since = onset(rows, lambda row: row.get("online") is False, now)
            # No observation means unavailable, not a fictitious timed outage.
            add("offline", since, limits.get("offline", 600) if since else 0)
            continue
        if status in {"conflict", "error"}:

            def same_sync(row: dict[str, Any], state: str = status) -> bool:
                return row.get("sync") == state

            add(
                "sync_conflict" if status == "conflict" else "sync_error",
                onset(rows, same_sync, now),
                severity="error",
            )
        elif status in {"pending", "syncing"}:
            add(
                "sync_stalled",
                onset(rows, lambda row: row.get("sync") in {"pending", "syncing"}, now),
                limits.get("sync_stalled", 900),
            )
        events = station.get("event_status") or {}
        if events.get("stream") in {"disconnected", "retrying", "connecting", "stopped"}:
            add(
                "event_gap",
                onset(
                    rows,
                    lambda row: (
                        row.get("events") in {"disconnected", "retrying", "connecting", "stopped"}
                    ),
                    now,
                ),
                limits.get("event_gap", 600),
            )
        clock = station.get("clock") or {}
        checked = stamp(clock.get("checked_at"))
        if (
            clock.get("status") == "ready"
            and clock.get("drift_state") in {"repeated_ahead", "repeated_behind"}
            and checked
            and timedelta(0) <= now - checked <= timedelta(hours=1)
        ):
            add("clock_drift", checked)
    return sorted(
        alerts,
        key=lambda row: (
            row["severity"] != "error",
            row["observed_since"] or now.isoformat(),
            row["id"],
        ),
    )


class FleetAlerts:
    def __init__(
        self, save: Callable[[dict[str, Any]], Awaitable[None]], changed: Callable[[], None]
    ) -> None:
        self._save, self._changed = save, changed
        self._lock = asyncio.Lock()
        self._data: dict[str, Any] = {"schema": 1, "revision": 0, "suppressions": {}}

    def load(self, data: Any) -> None:
        if data is None:
            return
        try:
            if (
                not isinstance(data, dict)
                or set(data) != {"schema", "revision", "suppressions"}
                or type(data["schema"]) is not int
                or data["schema"] != 1
                or type(data["revision"]) is not int
                or data["revision"] < 0
                or not isinstance(data["suppressions"], dict)
                or len(data["suppressions"]) > MAX_SUPPRESSIONS
            ):
                raise ValueError
            for key, row in data["suppressions"].items():
                if not isinstance(row, dict) or set(row) != {
                    "station_id",
                    "kind",
                    "reason",
                    "until",
                    "created_at",
                    "actor",
                }:
                    raise ValueError
                text_field(row["station_id"], 128)
                text_field(row["actor"], 128)
                if (
                    row["kind"] not in KINDS | {"maintenance"}
                    or row["reason"] not in REASONS
                    or key != f"{row['station_id']}/{row['kind']}"
                ):
                    raise ValueError
                until, created = stamp(row["until"]), stamp(row["created_at"])
                if (
                    until is None
                    or created is None
                    or not timedelta(0) < until - created <= timedelta(days=7)
                ):
                    raise ValueError
        except (TypeError, ValueError, KeyError, AccessError, OverflowError):
            raise AccessError("invalid_storage") from None
        self._data = deepcopy(data)

    async def action(
        self,
        revision: int,
        station_id: str,
        kind: str,
        action: str,
        duration_minutes: int,
        reason: str,
        actor: str,
        *,
        now: datetime | None = None,
    ) -> dict[str, Any]:
        now = now or datetime.now(UTC)
        text_field(station_id, 128)
        text_field(actor, 128)
        if (
            not isinstance(kind, str)
            or kind not in KINDS | {"maintenance"}
            or not isinstance(action, str)
            or action not in {"suppress", "restore"}
            or now.tzinfo is None
        ):
            raise AccessError("invalid_fields")
        if action == "suppress" and (
            type(duration_minutes) is not int
            or duration_minutes not in DURATIONS
            or not isinstance(reason, str)
            or reason not in REASONS
        ):
            raise AccessError("invalid_fields")
        async with self._lock:
            if type(revision) is not int or revision != self._data["revision"]:
                raise AccessError("revision_conflict")
            draft = deepcopy(self._data)
            draft["suppressions"] = {
                key: row for key, row in draft["suppressions"].items() if live(row, now)
            }
            key = f"{station_id}/{kind}"
            if action == "restore":
                draft["suppressions"].pop(key, None)
            else:
                if (
                    key not in draft["suppressions"]
                    and len(draft["suppressions"]) >= MAX_SUPPRESSIONS
                ):
                    raise AccessError("fleet_alert_limit")
                draft["suppressions"][key] = {
                    "station_id": station_id,
                    "kind": kind,
                    "reason": reason,
                    "until": (now + timedelta(minutes=duration_minutes)).isoformat(),
                    "created_at": now.isoformat(),
                    "actor": actor,
                }
            if draft == self._data:
                return {"revision": self._data["revision"]}
            draft["revision"] += 1

            async def persist() -> None:
                await self._save(deepcopy(draft))
                self._data = draft
                self._changed()

            task = asyncio.create_task(persist())
            cancelled = False
            while not task.done():
                try:
                    await asyncio.shield(task)
                except asyncio.CancelledError:
                    cancelled = True
            task.result()
            if cancelled:
                raise asyncio.CancelledError
            return {"revision": self._data["revision"]}

    def report(
        self,
        stations: list[dict[str, Any]],
        history: dict[str, list[dict[str, Any]]],
        *,
        offset: int = 0,
        limit: int = 100,
        station_id: str = "",
        kind: str = "",
        include_suppressed: bool = False,
        now: datetime | None = None,
        thresholds: dict[str, dict[str, int]] | None = None,
    ) -> dict[str, Any]:
        if (
            type(offset) is not int
            or offset < 0
            or type(limit) is not int
            or not 1 <= limit <= 200
            or type(include_suppressed) is not bool
            or not isinstance(station_id, str)
            or not isinstance(kind, str)
            or kind
            and kind not in KINDS
        ):
            raise AccessError("invalid_fields")
        now = now or datetime.now(UTC)
        policies = {key: row for key, row in self._data["suppressions"].items() if live(row, now)}
        rows = observed_alerts(stations, history, now, thresholds)
        for row in rows:
            suppression = policies.get(f"{row['station_id']}/maintenance") or policies.get(
                row["id"]
            )
            row["suppressed"] = bool(suppression)
            row["suppression"] = deepcopy(suppression)
        active = sum(not row["suppressed"] for row in rows)
        filtered = [
            row
            for row in rows
            if (include_suppressed or not row["suppressed"])
            and (not station_id or row["station_id"] == station_id)
            and (not kind or row["kind"] == kind)
        ]
        configured = {station["id"] for station in stations}
        return {
            "revision": self._data["revision"],
            "generated_at": now.isoformat(),
            "items": filtered[offset : offset + limit],
            "total": len(filtered),
            "offset": offset,
            "next_offset": offset + limit if offset + limit < len(filtered) else None,
            "active_count": active,
            "suppressed_count": len(rows) - active,
            "suppressions": [
                deepcopy(row) for row in policies.values() if row["station_id"] in configured
            ],
            "thresholds_seconds": {"offline": 600, "sync_stalled": 900, "event_gap": 600},
            **({"station_thresholds_seconds": deepcopy(thresholds)} if thresholds else {}),
            "evidence_scope": "observed_health_not_physical_acceptance",
        }
