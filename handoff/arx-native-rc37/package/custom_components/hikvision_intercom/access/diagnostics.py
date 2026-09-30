"""Bounded synchronization breadcrumbs with pseudonyms and allowlisted errors only."""

from __future__ import annotations

import json
import logging
from collections import OrderedDict, deque
from collections.abc import Callable
from copy import deepcopy
from time import monotonic
from typing import Any

from ..exceptions import (
    HikvisionAuthError,
    HikvisionBusyError,
    HikvisionCapacityError,
    HikvisionConflictError,
    HikvisionConnectionError,
    HikvisionError,
    HikvisionTimeoutError,
    HikvisionUnsupportedError,
    HikvisionValidationError,
)
from ..hardening import RequestMetrics
from .models import AccessError, utc_now

_LOGGER = logging.getLogger(__name__)
STEPS = frozenset(
    {
        "queued",
        "identity",
        "capabilities",
        "inventory",
        "person_read",
        "reconcile",
        "journal",
        "create_person",
        "update_person",
        "delete_person",
        "create_card",
        "update_card",
        "delete_card",
        "readback",
        "complete",
    }
)
SAFE_ERRORS = frozenset(
    {
        "invalid_timing_policy",
        "schedule_runtime_unavailable",
        "schedule_no_safe_slots",
        "schedule_deployment_incomplete",
        "schedule_station_clock_unverified",
        "schedule_station_timezone_unverified",
        "schedule_inventory_incomplete",
        "schedule_plan_users_unreadable",
        "schedule_plan_user_defaults",
        "schedule_plan_external_references",
        "schedule_plan_holiday_membership_unknown",
        "schedule_plan_active_resources",
        "schedule_plan_observation_incomplete",
        "schedule_source_changed",
        "schedule_resource_changed",
        "schedule_deployment_busy",
        "schedule_deployment_limit",
        "schedule_user_capability_unknown",
        "schedule_binding_invalid",
        "revision_conflict",
        "unmanaged_employee",
        "device_changed",
        "card_owned_elsewhere",
        "pin_owned_elsewhere",
        "ambiguous_write",
        "connection_failed",
        "device_busy",
        "device_conflict",
        "capacity_exhausted",
        "authentication_failed",
        "operation_unsupported",
        "device_rejected",
        "invalid_response",
        "validity_rejected",
        "station_has_no_managed_lock",
        "unmanaged_lock",
        "schedule_unverified",
        "readback_mismatch",
        "delete_not_verified",
        "person_capacity",
        "card_capacity",
        "person_exceeds_capabilities",
        "card_exceeds_capabilities",
        "pin_exceeds_capabilities",
        "unsupported_user_type",
        "pin_device_managed",
        "unreadable_validity",
        "validity_timezone_mismatch",
        "pin_readback_unavailable",
        "unsupported_credentials",
        "storage_write_failed",
        "storage_or_internal_error",
        "station_unloaded",
        "station_offline",
    }
)
SAFE_FIELDS = frozenset(
    {
        "beginTime",
        "endTime",
        "Valid",
        "name",
        "employeeNo",
        "userType",
        "doorRight",
        "RightPlan",
        "localUIRight",
        "pin",
        "cards",
        "cardType",
        "unsupported_credentials",
    }
)
SAFE_SUB_STATUS = frozenset(
    {
        "badjsoncontent",
        "badxmlcontent",
        "notsupport",
        "notsupported",
        "methodnotallowed",
        "unauthorized",
        "nopermission",
        "cardnoalreadyexist",
        "employeenoalreadyexist",
        "deviceuseralreadyexist",
        "userpasswordalreadyexist",
        "cardfull",
        "userfull",
        "devicecardfull",
        "deviceuserfull",
        "cardfullperuser",
    }
)


def error_code(error: Exception) -> str:
    if isinstance(error, AccessError):
        return error.code if error.code in SAFE_ERRORS else "storage_or_internal_error"
    if isinstance(error, HikvisionError):
        if error.sub_status == "badjsoncontent" and error.fields == ("beginTime", "endTime"):
            return "validity_rejected"
        for kind, code in (
            (HikvisionAuthError, "authentication_failed"),
            (HikvisionBusyError, "device_busy"),
            (HikvisionCapacityError, "capacity_exhausted"),
            (HikvisionConflictError, "device_conflict"),
            (HikvisionConnectionError, "connection_failed"),
            (HikvisionTimeoutError, "connection_failed"),
            (HikvisionUnsupportedError, "operation_unsupported"),
            (HikvisionValidationError, "invalid_response"),
        ):
            if isinstance(error, kind):
                return code
        return "device_rejected"
    return "storage_or_internal_error"


class SyncDiagnostics:
    """Keep the latest 200 stages in memory; repeated warnings are throttled for five minutes."""

    def __init__(self, fingerprint: Callable[[Any], str]) -> None:
        self._fingerprint = fingerprint
        self._rows: deque[dict[str, Any]] = deque(maxlen=200)
        self._active: OrderedDict[tuple[str, str | None], str] = OrderedDict()
        self._warnings: OrderedDict[str, float] = OrderedDict()
        self._started: OrderedDict[tuple[str, str | None], float] = OrderedDict()
        self._quality: OrderedDict[str, RequestMetrics] = OrderedDict()
        self._repeat_counts: dict[str, int] = {}
        self._failed: OrderedDict[tuple[str, str | None], None] = OrderedDict()

    def reference(self, value: str) -> str:
        return self._fingerprint({"sync_diagnostic_reference": value})[:12]

    def _key(self, station: str, user: str | None) -> tuple[str, str | None]:
        return self.reference(station), self.reference(user) if user is not None else None

    def queued(self, station: str) -> None:
        self._record(self._key(station, None), "queued", "started")

    def stage(self, station: str, user: str | None, step: str) -> None:
        key = self._key(station, user)
        if user is not None and key not in self._started:
            self._started[key] = monotonic()
            if key in self._failed:
                self._repeat_counts[key[0]] = self._repeat_counts.get(key[0], 0) + 1
                self._failed.pop(key)
            if len(self._started) > 64:
                self._started.popitem(last=False)
        self._active[key] = step if step in STEPS else "reconcile"
        self._active.move_to_end(key)
        if len(self._active) > 64:
            self._active.popitem(last=False)
        self._record(key, self._active[key], "started")

    def finish(
        self,
        station: str,
        user: str | None,
        *,
        error: Exception | None = None,
        outcome: str = "succeeded",
    ) -> None:
        key = self._key(station, user)
        started = self._started.pop(key, None)
        if started is not None and outcome != "cancelled":
            metrics = self._quality.setdefault(key[0], RequestMetrics())
            metrics.record(monotonic() - started, error is not None)
            self._quality.move_to_end(key[0])
            if len(self._quality) > 256:
                evicted, _ = self._quality.popitem(last=False)
                self._repeat_counts.pop(evicted, None)
            if error:
                self._failed[key] = None
                if len(self._failed) > 256:
                    self._failed.popitem(last=False)
        step = self._active.pop(key, "complete")
        self._record(key, step, "failed" if error else outcome, error)

    def quality(self, station: str) -> dict[str, Any]:
        reference = self.reference(station)
        metrics = self._quality.get(reference)
        return {
            **(metrics.quality() if metrics else RequestMetrics().quality()),
            "repeat_attempts_after_failure": self._repeat_counts.get(reference, 0),
            "scope": "person_reconciliation_attempt_not_queue_wait_or_physical_access",
        }

    def _record(
        self,
        key: tuple[str, str | None],
        step: str,
        outcome: str,
        error: Exception | None = None,
    ) -> None:
        row: dict[str, Any] = {
            "timestamp": utc_now(),
            "station_ref": key[0],
            "user_ref": key[1],
            "step": step,
            "outcome": outcome
            if outcome in {"started", "succeeded", "failed", "cancelled"}
            else "failed",
        }
        if error:
            row["error"] = error_code(error)
            if isinstance(error, HikvisionError):
                if type(error.status_code) is int and 0 <= error.status_code <= 9:
                    row["status_code"] = error.status_code
                if error.sub_status in SAFE_SUB_STATUS:
                    row["sub_status"] = error.sub_status
                fields = [field for field in error.fields if field in SAFE_FIELDS]
                if fields:
                    row["fields"] = sorted(set(fields))
        self._rows.append(row)
        message = json.dumps(row, sort_keys=True)
        _LOGGER.debug("Access sync %s", message)
        if error:
            signature = json.dumps(
                {k: v for k, v in row.items() if k != "timestamp"}, sort_keys=True
            )
            now = monotonic()
            if now - self._warnings.get(signature, float("-inf")) >= 300:
                _LOGGER.warning("Access sync failed %s", message)
                self._warnings[signature] = now
                self._warnings.move_to_end(signature)
                if len(self._warnings) > 200:
                    self._warnings.popitem(last=False)

    def public(self, station: str | None = None) -> dict[str, Any]:
        reference = self.reference(station) if station is not None else None
        return {
            "retention": "last_200_stages_since_start",
            "recent": deepcopy(
                [row for row in self._rows if reference is None or row["station_ref"] == reference]
            ),
        }
