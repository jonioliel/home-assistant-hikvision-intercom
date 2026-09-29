"""Read-only central policy prediction and explicitly historical device evidence."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from .models import AccessError
from .timing_policy import rolling_validity


def instant(value: Any) -> datetime:
    try:
        if not isinstance(value, str) or len(value) > 48:
            raise ValueError
        result = datetime.fromisoformat(value)
        if result.tzinfo is None:
            raise ValueError
        result = result.astimezone(UTC)
        if (
            not datetime(1970, 1, 1, tzinfo=UTC)
            <= result
            <= datetime(2037, 12, 31, 23, 59, 59, tzinfo=UTC)
        ):
            raise ValueError
        return result
    except (ValueError, OverflowError):
        raise AccessError("scenario_invalid_time") from None


def contains(start: Any, end: Any, at: datetime) -> bool:
    return (start is None or instant(start) <= at) and (end is None or at < instant(end))


def evaluate(
    person: dict[str, Any],
    station: str,
    lock: int,
    at: str,
    *,
    station_status: str = "unknown",
    readback: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """No I/O, writes, credential inspection or physical admission claim.

    Group inheritance and personal denies are already resolved in assignments.
    A historical timing readback only proves that interval at checked_at; it does
    not prove the current clock, connectivity, credentials or physical outcome.
    """
    if type(lock) is not int or lock not in (1, 2):
        raise AccessError("invalid_lock")
    target = instant(at)
    assignment = person.get("assignments", {}).get(station, {})
    timing = person.get("access_timing_policy")
    reason = "allowed"
    if person.get("archived_at"):
        reason = "archived"
    elif person.get("active") is not True:
        reason = "inactive"
    elif assignment.get("enabled") is not True:
        reason = "no_assignment"
    elif lock not in assignment.get("allowed_locks", []):
        reason = "lock_not_assigned"
    elif not contains(person.get("valid_from"), person.get("valid_until"), target):
        reason = "outside_validity"
    elif timing:
        window = rolling_validity(
            timing["schedule"],
            now=target,
            valid_from=person.get("valid_from"),
            valid_until=person.get("valid_until"),
        )
        if not contains(window["beginTime"], window["endTime"], target):
            reason = "outside_schedule"
    observed: dict[str, Any] = {
        "source": "cached_sync_metadata",
        "sync_state": assignment.get("sync_state", "unknown"),
        "last_sync_at": assignment.get("last_sync_at"),
        "revision_matches": assignment.get("applied_revision") == assignment.get("desired_revision")
        and assignment.get("applied_revision") is not None,
        "timing": {"status": "unavailable"},
    }
    if readback:
        # Explicit whitelist: never expose binding fingerprints, identity or secrets.
        try:
            if readback.get("mode") not in ("ha", "native") or (
                readback.get("mode") == "ha"
                and (readback.get("valid_from") is None or readback.get("valid_until") is None)
            ):
                raise AccessError("invalid_validity")
            checked = instant(readback.get("checked_at"))
            inside = contains(readback.get("valid_from"), readback.get("valid_until"), target)
            current = bool(
                timing
                and readback.get("mode") == timing["mode"]
                and readback.get("revision") == person.get("revision")
            )
            observed["timing"] = {
                "status": "historical" if current else "previous_policy",
                "mode": readback.get("mode"),
                "checked_at": checked.isoformat(timespec="seconds"),
                "valid_from": readback.get("valid_from"),
                "valid_until": readback.get("valid_until"),
                # Native readback Valid is not evidence of its weekly RightPlan.
                "interval_contains_target": inside
                if current and readback.get("mode") == "ha"
                else None,
            }
        except AccessError:
            observed["timing"] = {"status": "unavailable"}
    return {
        "read_only": True,
        "person_revision": person["revision"],
        "station_id": station,
        "lock_id": lock,
        "at": target.isoformat(timespec="seconds"),
        "desired": {
            "allowed": reason == "allowed",
            "reason": reason,
            "timing_mode": timing["mode"] if timing else "unrestricted",
            "draft_ignored": bool(person.get("access_timing_draft") and not timing),
        },
        "observed": observed,
        "station_status": station_status,
        "physical_result": "not_verified",
    }
