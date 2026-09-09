"""Explain normalized event evidence without retaining credentials or raw payloads."""

from __future__ import annotations

from collections import Counter, deque
from datetime import UTC, datetime
from math import ceil
from statistics import median
from typing import Any

from .events import timestamp


def explain_event(row: dict[str, Any]) -> dict[str, Any]:
    when, received = timestamp(row.get("timestamp")), timestamp(row.get("received_at"))
    lag = (
        round((received - when).total_seconds(), 3)
        if when and received and row.get("time_source") == "device"
        else None
    )
    source = row.get("source")
    if source == "query":
        origin = "history_query"
    elif source == "call_status":
        origin = "call_poll"
    elif row.get("time_source") != "device":
        origin = "device_time_missing"
    elif lag is not None and lag < -5:
        origin = "device_time_ahead"
    elif lag is not None and lag > 90:
        origin = "delayed_stream"
    elif row.get("recovered"):
        origin = "device_not_current"
    else:
        origin = "live_stream"
    identity = (
        "identified"
        if row.get("person_name")
        else "id_only"
        if row.get("employee_no")
        else "identity_unavailable"
    )
    return {
        "identity_state": identity,
        "origin": origin,
        "arrival_delay_seconds": lag,
        "time_source": row.get("time_source"),
        "source": source,
        "live_automation": not row.get("recovered", True),
    }


def event_support(row: dict[str, Any], version: str) -> dict[str, Any]:
    """Export has no person, credential, station ID or raw device configuration."""
    return {
        "format": "hikvision_intercom.event_support",
        "version": 1,
        "integration_version": version,
        "case_id": row["id"][:16],
        "event": {
            key: row[key]
            for key in (
                "timestamp",
                "received_at",
                "event_type",
                "major",
                "minor",
                "authentication",
                "result",
                "recovered",
            )
        },
        "evidence": explain_event(row),
    }


class EventTelemetry:
    """Bounded process-lifetime counters; history retrieval is not live delivery latency."""

    def __init__(self) -> None:
        self.seen = 0
        self.accepted = 0
        self.origins: Counter[str] = Counter()
        self.identities: Counter[str] = Counter()
        self.delays: deque[float] = deque(maxlen=100)
        self.last_received: str | None = None
        self.last_live: str | None = None
        self.started_at = datetime.now(UTC).isoformat()

    def observe(self, row: dict[str, Any], accepted: bool) -> None:
        self.seen += 1
        self.last_received = row["received_at"]
        if not accepted:
            return
        self.accepted += 1
        evidence = explain_event(row)
        self.origins[evidence["origin"]] += 1
        self.identities[evidence["identity_state"]] += 1
        if row["source"] == "stream" and evidence["arrival_delay_seconds"] is not None:
            self.delays.append(evidence["arrival_delay_seconds"])
        if not row["recovered"]:
            self.last_live = row["received_at"]

    def public(self) -> dict[str, Any]:
        values = sorted(self.delays)
        return {
            "started_at": self.started_at,
            "seen": self.seen,
            "accepted": self.accepted,
            "duplicates": self.seen - self.accepted,
            "origins": dict(self.origins),
            "identities": dict(self.identities),
            "last_received": self.last_received,
            "last_live": self.last_live,
            "stream_arrival_delay": {
                "samples": len(values),
                "min": values[0] if values else None,
                "max": values[-1] if values else None,
                "median": median(values) if values else None,
                "p95": values[ceil(len(values) * 0.95) - 1] if values else None,
            },
        }
