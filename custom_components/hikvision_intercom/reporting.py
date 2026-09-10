"""Statistics over retained, normalized events; a report never infers missing activity."""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable
from datetime import datetime
from typing import Any

from .clock import UTC_ZONE, localize
from .events import timestamp
from .exceptions import HikvisionValidationError


def audience_filter(
    filters: dict[str, Any],
    policy: dict[str, Any],
    audience: dict[tuple[str, str], dict[str, Any]],
) -> tuple[dict[str, Any], Callable[[dict[str, Any]], bool] | None]:
    """Current membership is never inferred from a name or an unobserved employee ID."""
    base = {k: v for k, v in filters.items() if k not in {"current_group", "current_profile"}}
    if not set(filters) & {"current_group", "current_profile"}:
        return base, None
    group = filters.get("current_group")
    profile = filters.get("current_profile", {})
    groups = {item["id"] for item in policy.get("groups", [])}
    fields = {item["id"] for item in policy.get("fields", [])}
    if (
        "current_group" in filters
        and (not isinstance(group, str) or group not in groups)
        or not isinstance(profile, dict)
        or not profile
        and "current_profile" in filters
        or isinstance(profile, dict)
        and (
            len(profile) > 12
            or any(
                key not in fields
                or not isinstance(value, str)
                or not 1 <= len(value) <= 100
                or any(ord(char) < 32 for char in value)
                for key, value in profile.items()
            )
        )
    ):
        raise HikvisionValidationError("Invalid current membership filter")

    def matches(row: dict[str, Any]) -> bool:
        if row.get("time_source") != "device" or not row.get("employee_no"):
            return False
        member = audience.get((row["station_id"], row["employee_no"]))
        when = timestamp(row["timestamp"])
        observed = timestamp(member["observed_at"]) if member else None
        return bool(
            member
            and when
            and observed
            and observed <= when
            and (group is None or group in member["group_ids"])
            and all(member["profile"].get(key) == value for key, value in profile.items())
        )

    return base, matches


def event_report(
    rows: list[dict[str, Any]], now: datetime, zones: dict[str, dict[str, Any]] | None = None
) -> dict[str, Any]:
    by_station: dict[str, Counter[str]] = {}
    by_day: dict[str, Counter[str]] = {}
    totals: Counter[str] = Counter()
    methods: Counter[str] = Counter()
    times = []
    for row in rows:
        when = timestamp(row["timestamp"])
        if when is None:
            continue
        times.append(when)
        station = by_station.setdefault(row["station_id"], Counter())
        zone = (zones or {}).get(row["station_id"], UTC_ZONE)
        day = by_day.setdefault(localize(when, zone).date().isoformat(), Counter())
        # Opening records can accompany credential-authentication events. Keep them
        # separate; counting every record as a visit would double-count one operation.
        kind = (
            "authentication"
            if row["event_type"] in {"access_granted", "access_denied"}
            else "other"
        )
        for counter in (totals, station, day):
            counter["records"] += 1
            counter[kind] += 1
            counter["recovered"] += int(row["recovered"])
            if kind == "authentication":
                counter[row["result"] if row["result"] in {"granted", "denied"} else "unknown"] += 1
        if kind == "authentication":
            methods[row["authentication"]] += 1
    keys = ("records", "authentication", "granted", "denied", "unknown", "other", "recovered")

    def counts(counter: Counter[str]) -> dict[str, int]:
        return {key: counter[key] for key in keys}

    return {
        "generated_at": now.isoformat(),
        "day_timezone": "station" if zones is not None else "UTC",
        "oldest": min(times).isoformat() if times else None,
        "newest": max(times).isoformat() if times else None,
        "totals": counts(totals),
        "methods": dict(sorted(methods.items())),
        "by_station": [
            {"station_id": key, **counts(counter)} for key, counter in sorted(by_station.items())
        ],
        "by_day": [{"day": key, **counts(counter)} for key, counter in sorted(by_day.items())],
    }


def build_report(
    rows: list[dict[str, Any]],
    now: datetime,
    names: dict[str, str],
    export: bool,
    zones: dict[str, dict[str, Any]] | None = None,
    printable: bool = False,
) -> dict[str, Any]:
    """Aggregate and optionally encode detached records outside the HA event loop."""
    result = event_report(rows, now, zones)
    if printable:
        fields = (
            "employee_no",
            "person_name",
            "event_type",
            "authentication",
            "result",
            "door",
            "card",
            "recovered",
            "time_source",
        )
        result["print_records"] = [
            {
                **{field: row[field] for field in fields},
                "station": names.get(row["station_id"], row["station_id"]),
                "timestamp": row["timestamp"],
                "display_timestamp": localize(
                    datetime.fromisoformat(row["timestamp"]),
                    (zones or {}).get(row["station_id"], UTC_ZONE),
                ).isoformat(),
                "display_timezone": (zones or {}).get(row["station_id"], UTC_ZONE)["name"],
            }
            for row in rows
        ]
    if export:
        from .access.csv_transfer import csv_text

        headers = (
            "timestamp",
            "station",
            "employee_no",
            "person_name",
            "event_type",
            "authentication",
            "result",
            "door",
            "masked_card",
            "recovered",
            "time_source",
            "display_timestamp",
            "display_timezone",
        )
        result["csv"] = csv_text(
            headers,
            (
                (
                    row["timestamp"],
                    names.get(row["station_id"], row["station_id"]),
                    row["employee_no"],
                    row["person_name"],
                    row["event_type"],
                    row["authentication"],
                    row["result"],
                    row["door"],
                    row["card"],
                    str(row["recovered"]).lower(),
                    row["time_source"],
                    localize(
                        datetime.fromisoformat(row["timestamp"]),
                        (zones or {}).get(row["station_id"], UTC_ZONE),
                    ).isoformat(),
                    (zones or {}).get(row["station_id"], UTC_ZONE)["name"],
                )
                for row in rows
            ),
        )
    return result
