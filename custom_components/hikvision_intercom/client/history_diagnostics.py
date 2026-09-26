"""Explicit read-only history inspection without moving recovery cursors or firing events."""

from __future__ import annotations

import asyncio
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any

from ..event_trace import identity_evidence
from ..events import normalize_event, timestamp
from ..exceptions import HikvisionError, HikvisionUnsupportedError, HikvisionValidationError
from .client import HikvisionClient
from .clock import ClockClient
from .events import EventClient, HistoryWindowFull


async def inspect_history(
    client: HikvisionClient, start_text: str, end_text: str
) -> dict[str, Any]:
    start, end = timestamp(start_text), timestamp(end_text)
    if start is None or end is None or not timedelta(0) < end - start <= timedelta(days=1):
        raise HikvisionValidationError(
            "History inspection requires an aware range of at most one day"
        )
    # A separate optional read lane; share the bounded connection pool, not the lock.
    reader = HikvisionClient(
        client._session, client.settings, expected_identity=client._expected_identity
    )
    report: dict[str, Any] = {
        "format": "hikvision_intercom.history_inspection",
        "schema": 1,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "generated_at": datetime.now(UTC).isoformat(),
        "complete": False,
        "filter_honored": None,
        "records": 0,
        "groups": [],
        "clock": None,
        "recovery_cursor_changed": False,
        "live_events_emitted": 0,
    }
    async with asyncio.timeout(45):
        await reader.async_confirm_identity()
        try:
            clock = await ClockClient(reader).async_read()
            report["clock"] = {
                key: clock.get(key) for key in ("checked_at", "skew_seconds", "time_mode")
            }
        except HikvisionError:
            report["clock_error"] = "clock_read_failed"
        events = EventClient(reader)
        if not await events.async_capabilities():
            raise HikvisionUnsupportedError("Event history is not advertised")
        try:
            rows = await events.async_history(start, end)
        except HistoryWindowFull:
            report["error"] = "history_window_full"
            return report
        groups: Counter[tuple[int, int, str, str, bool, bool]] = Counter()
        honored = True
        invalid = 0
        overflow = 0
        now = datetime.now(UTC)
        for raw in rows:
            when = timestamp(raw.get("time"))
            honored = honored and when is not None and start <= when <= end
            normalized = normalize_event(
                raw, "inspection", bytes(32), received=now, selected_api=None, historical=True
            )
            if normalized is None:
                invalid += 1
                continue
            evidence = identity_evidence(raw, True, normalized)
            key = (
                normalized["major"],
                normalized["minor"],
                normalized["authentication"],
                normalized["result"],
                evidence["normalized_employee"],
                evidence["normalized_name"],
            )
            if key in groups or len(groups) < 64:
                groups[key] += 1
            else:
                overflow += 1
        report.update(
            complete=True,
            filter_honored=honored if rows else None,
            records=len(rows),
            device_local_times=sum(
                raw.get("_time_interpretation") == "device_local" for raw in rows
            ),
            invalid_records=invalid,
            ungrouped_records=overflow,
            groups=[
                {
                    "major": k[0],
                    "minor": k[1],
                    "authentication": k[2],
                    "result": k[3],
                    "has_employee": k[4],
                    "has_name": k[5],
                    "count": v,
                }
                for k, v in sorted(groups.items())
            ],
        )
        return report
