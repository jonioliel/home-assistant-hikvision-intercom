"""Opt-in, bounded observation of call polls and event normalization; no raw data."""

from __future__ import annotations

from collections import OrderedDict
from copy import deepcopy
from datetime import UTC, datetime
from time import monotonic
from typing import Any
from uuid import uuid4

from .access.models import AccessError
from .events import timestamp


def identity_evidence(
    payload: dict[str, Any], historical: bool, row: dict[str, Any] | None
) -> dict[str, Any]:
    outer = payload.get("EventNotificationAlert", payload)
    source = (
        outer
        if historical
        else outer.get("AccessControllerEvent")
        if isinstance(outer, dict)
        else None
    )
    source = source if isinstance(source, dict) else {}
    fields = {}
    for key in ("employeeNoString", "employeeNo", "name"):
        value = source.get(key)
        fields[key] = (
            "missing"
            if key not in source
            else "empty"
            if value in (None, "", 0, "0")
            else "provided"
            if isinstance(value, str) or type(value) is int
            else "invalid_type"
        )
    return {
        "source_fields": fields,
        "normalized_employee": bool(row and row.get("employee_no")),
        "normalized_name": bool(row and row.get("person_name")),
        "normalized": row is not None,
        "time_interpretation": "verified_device_zone"
        if historical and source.get("_time_interpretation") == "device_local"
        else "source_timestamp",
    }


class EventTrace:
    """One explicit 90-second capture, up to 300 observations, discarded on reload."""

    def __init__(self) -> None:
        self.run: dict[str, Any] | None = None
        self.deadline = 0.0
        self.evidence: OrderedDict[str, dict[str, Any]] = OrderedDict()

    def start(self, initial_state: str) -> dict[str, Any]:
        if self.active():
            raise AccessError("device_busy")
        self.deadline = monotonic() + 90
        self.run = {
            "capture_id": uuid4().hex,
            "state": "recording",
            "started_at": datetime.now(UTC).isoformat(),
            "duration_seconds": 90,
            "records": [],
            "dropped": 0,
        }
        self.call(initial_state, baseline=True)
        return self.public()

    def active(self) -> bool:
        if self.run and self.run["state"] == "recording" and monotonic() >= self.deadline:
            self.run["state"] = "complete"
        return bool(self.run and self.run["state"] == "recording")

    def stop(self, capture_id: str) -> dict[str, Any]:
        if not self.run or self.run["capture_id"] != capture_id:
            raise AccessError("revision_conflict")
        self.active()
        if self.run["state"] == "recording":
            self.run["state"] = "stopped"
        return self.public()

    def public(self) -> dict[str, Any]:
        active = self.active()
        return {
            "format": "hikvision_intercom.event_trace",
            "schema": 1,
            "capture": deepcopy(self.run),
            "remaining_seconds": max(0, round(self.deadline - monotonic())) if active else 0,
            "physical_result": "unverified",
        }

    def _append(self, row: dict[str, Any]) -> None:
        if not self.active() or self.run is None:
            return
        rows = self.run["records"]
        now = datetime.now(UTC).isoformat()
        if rows and rows[-1]["observation"] == row:
            rows[-1]["count"] += 1
            rows[-1]["last_at"] = now
        elif len(rows) < 300:
            rows.append({"at": now, "last_at": now, "count": 1, "observation": row})
        else:
            self.run["dropped"] += 1

    def call(self, state: str | None, *, baseline: bool = False) -> None:
        self._append(
            {
                "kind": "call_baseline" if baseline else "call_poll",
                "state": state
                if state in {"idle", "ringing", "in_call", "unknown"}
                else "unavailable",
            }
        )

    def event(
        self,
        payload: dict[str, Any],
        row: dict[str, Any] | None,
        *,
        historical: bool = False,
        resolved: bool = False,
    ) -> None:
        evidence = identity_evidence(payload, historical, row)
        evidence["central_name_resolved"] = resolved
        if row:
            self.evidence[row["id"]] = evidence
            self.evidence.move_to_end(row["id"])
            while len(self.evidence) > 128:
                self.evidence.popitem(last=False)
        outer = payload.get("EventNotificationAlert", payload)
        outer = outer if isinstance(outer, dict) else {}
        family = outer.get("eventType")
        family = (
            family
            if isinstance(family, str)
            and family
            in {
                "AccessControllerEvent",
                "heartBeat",
                "VideoIntercomEvent",
                "callStatus",
                "voiceTalkEvent",
            }
            else "other"
        )
        voice = outer.get("VoiceTalkEvent")
        command = voice.get("cmdType") if isinstance(voice, dict) else None
        command = (
            command
            if isinstance(command, str)
            and command in {"request", "cancel", "answer", "reject", "hangUp"}
            else None
        )
        when = timestamp(outer.get("time") if historical else outer.get("dateTime"))
        self._append(
            {
                "kind": "history" if historical else "stream",
                "family": family,
                "voice_command": command if family == "voiceTalkEvent" else None,
                "device_time": when.isoformat() if when else None,
                "major": row["major"] if row else None,
                "minor": row["minor"] if row else None,
                "authentication": row["authentication"] if row else "unknown",
                "result": row["result"] if row else "unknown",
                "live_automation": not row["recovered"] if row else False,
                "identity": evidence,
            }
        )
