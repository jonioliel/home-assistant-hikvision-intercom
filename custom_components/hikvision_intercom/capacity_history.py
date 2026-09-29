"""Bounded trends from fresh complete inventories and advertised limits only."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from copy import deepcopy
from datetime import datetime, timedelta
from typing import Any

from .access.models import AccessError
from .maintenance_jobs import moment
from .operations_center import canonical, exact, integer, text

MAX_STATIONS = 500
MAX_SAMPLES = 64
MAX_TOTAL = 6000


class CapacityHistory:
    def __init__(self, save: Callable[[dict[str, Any]], Awaitable[None]]) -> None:
        self._save = save
        self._lock = asyncio.Lock()
        self.data: dict[str, Any] = {"schema": 1, "stations": {}}

    def validate(self, data: Any) -> None:
        exact(data, {"schema", "stations"})
        if (
            type(data["schema"]) is not int
            or data["schema"] != 1
            or not isinstance(data["stations"], dict)
            or len(data["stations"]) > MAX_STATIONS
        ):
            raise AccessError("invalid_fields")
        total = 0
        for sid, rows in data["stations"].items():
            text(sid, 128)
            if not isinstance(rows, list) or not rows or len(rows) > MAX_SAMPLES:
                raise AccessError("invalid_fields")
            total += len(rows)
            previous = None
            for row in rows:
                exact(row, {"at", "identity_stamp", "users", "cards", "max_users", "max_cards"})
                at = moment(row["at"])
                if previous is not None and at <= previous:
                    raise AccessError("invalid_fields")
                previous = at
                stamp = text(row["identity_stamp"], 64)
                if len(stamp) != 64 or any(c not in "0123456789abcdef" for c in stamp):
                    raise AccessError("invalid_fields")
                for kind in ("users", "cards"):
                    integer(row[kind], 0, 10_000_000)
                    if row["max_" + kind] is not None:
                        integer(row["max_" + kind], 1, 10_000_000)
        if total > MAX_TOTAL or len(canonical(data)) > 2_000_000:
            raise AccessError("request_too_large")

    def load(self, data: Any) -> None:
        if data is None:
            return
        try:
            self.validate(data)
        except (AccessError, ValueError, TypeError, KeyError, OverflowError):
            raise AccessError("storage_corrupt") from None
        self.data = deepcopy(data)

    async def observe(self, observations: dict[str, dict[str, Any]], now: datetime) -> None:
        async with self._lock:
            candidate = deepcopy(self.data)
            # No new samples from repeated reads, stale/future inventories or a changed
            # identity paired with the old inventory timestamp.
            for sid, row in observations.items():
                moment_at = moment(row["at"])
                if moment_at > now + timedelta(minutes=5) or moment_at < now - timedelta(days=30):
                    continue
                rows = candidate["stations"].get(sid, [])
                if rows and moment_at <= moment(rows[-1]["at"]):
                    continue
                if rows and moment_at - moment(rows[-1]["at"]) < timedelta(minutes=5):
                    continue
                if sid not in candidate["stations"] and len(candidate["stations"]) >= MAX_STATIONS:
                    oldest = min(
                        candidate["stations"],
                        key=lambda key: moment(candidate["stations"][key][-1]["at"]),
                    )
                    del candidate["stations"][oldest]
                rows = [r for r in rows if moment(r["at"]) >= now - timedelta(days=30)]
                if rows and rows[-1]["identity_stamp"] != row["identity_stamp"]:
                    rows = []
                combined = [*rows, deepcopy(row)]
                # Keep the comparable baseline and recent observations. Dense scans
                # must not erase the only day-spanning baseline within five hours.
                if len(combined) > MAX_SAMPLES:
                    combined = [combined[0], *combined[-(MAX_SAMPLES - 1) :]]
                candidate["stations"][sid] = combined
            while sum(len(rows) for rows in candidate["stations"].values()) > MAX_TOTAL:
                eligible = [key for key, rows in candidate["stations"].items() if len(rows) > 2]
                oldest = min(eligible, key=lambda key: moment(candidate["stations"][key][1]["at"]))
                del candidate["stations"][oldest][1]
            self.validate(candidate)
            if candidate != self.data:
                await self._save(deepcopy(candidate))
                self.data = candidate

    def report(self, ids: dict[str, str], now: datetime) -> dict[str, Any]:
        records = []
        for sid, name in ids.items():
            rows = self.data["stations"].get(sid, [])
            latest = rows[-1] if rows else None
            compatible: list[dict[str, Any]] = []
            if latest:
                # Never bridge replacement hardware, firmware or limit changes.
                for row in reversed(rows):
                    if (
                        row["identity_stamp"] != latest["identity_stamp"]
                        or row["max_users"] != latest["max_users"]
                        or row["max_cards"] != latest["max_cards"]
                    ):
                        break
                    compatible.insert(0, row)
            age = max(0, int((now - moment(latest["at"])).total_seconds())) if latest else None
            fresh = age is not None and age <= 3600
            values: dict[str, Any] = {}
            for kind in ("users", "cards"):
                limit = latest["max_" + kind] if latest else None
                count = latest[kind] if latest else None
                span = (
                    (moment(compatible[-1]["at"]) - moment(compatible[0]["at"])).total_seconds()
                    / 86400
                    if len(compatible) >= 2
                    else 0.0
                )
                rate = (
                    (compatible[-1][kind] - compatible[0][kind]) / span
                    if len(compatible) >= 3 and span >= 1
                    else None
                )
                remaining = (
                    max(0, limit - count) if limit is not None and count is not None else None
                )
                days = (
                    round(remaining / rate, 1)
                    if fresh and remaining is not None and rate is not None and rate > 0
                    else None
                )
                used = (
                    round(100 * count / limit, 1)
                    if limit is not None and count is not None
                    else None
                )
                values[kind] = {
                    "count": count,
                    "advertised_limit": limit,
                    "used_percent": used,
                    "remaining": remaining,
                    "observed_growth_per_day": round(rate, 2) if rate is not None else None,
                    "estimated_days_to_limit": days,
                    "alert": "unknown"
                    if limit is None or count is None
                    else "stale"
                    if not fresh
                    else "at_limit"
                    if count >= limit
                    else "near_limit"
                    if used is not None and used >= 80
                    else "growth_to_limit"
                    if days is not None and days <= 30
                    else "observed",
                }
            records.append(
                {
                    "station_id": sid,
                    "name": name,
                    "sampled_at": latest["at"] if latest else None,
                    "age_seconds": age,
                    "fresh": fresh,
                    "sample_count": len(compatible),
                    "sample_span_days": round(span, 2) if latest else 0,
                    "users": values["users"],
                    "cards": values["cards"],
                    "programs": {"advertised_limit": None, "alert": "unknown"},
                }
            )
        return {
            "records": records,
            "basis": "complete_observed_inventories",
            "history_budget": {
                "stations": MAX_STATIONS,
                "per_station_samples": MAX_SAMPLES,
                "total_samples": MAX_TOTAL,
            },
            "forecast_is_estimate": True,
        }
