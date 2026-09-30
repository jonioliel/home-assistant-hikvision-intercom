"""Bounded runtime metrics and administrator request admission."""

from __future__ import annotations

import re
from collections import deque
from dataclasses import dataclass
from math import ceil, isfinite
from typing import Any


def firmware_label(value: object) -> str:
    if isinstance(value, str) and re.fullmatch(
        r"V?\d{1,3}\.\d{1,3}\.\d{1,3}(?: (?:build )?\d{6,8})?", value
    ):
        return value
    return "unknown"


class RequestMetrics:
    def __init__(self) -> None:
        self.samples: deque[float] = deque(maxlen=100)
        self.requests = 0
        self.failures = 0
        self._outcomes: deque[bool] = deque(maxlen=100)
        self._baseline: list[float] = []
        self._comparison: deque[float] = deque(maxlen=100)

    def record(self, elapsed: float, failed: bool) -> None:
        if not isfinite(elapsed) or elapsed < 0:
            return
        self.requests += 1
        self.failures += int(failed)
        self.samples.append(round(max(0, elapsed) * 1000, 1))
        self._outcomes.append(bool(failed))
        if len(self._baseline) < 20:
            self._baseline.append(self.samples[-1])
        else:
            self._comparison.append(self.samples[-1])

    @staticmethod
    def _p95(values: list[float]) -> float | None:
        return sorted(values)[ceil(len(values) * 0.95) - 1] if values else None

    def quality(self) -> dict[str, Any]:
        """A reproducible startup reference, not a contractual performance target."""
        baseline = self._p95(self._baseline) if len(self._baseline) == 20 else None
        recent = self._p95(list(self._comparison)) if len(self._comparison) >= 20 else None
        return {
            **self.public(),
            "basis": "since_runtime_start",
            "failure_percent": round(self.failures * 100 / self.requests, 2)
            if self.requests
            else None,
            "window_failure_percent": round(sum(self._outcomes) * 100 / len(self._outcomes), 2)
            if self._outcomes
            else None,
            "baseline_samples": len(self._baseline),
            "baseline_p95_ms": baseline,
            "comparison_samples": len(self._comparison),
            "comparison_p95_ms": recent,
            "p95_delta_ms": round(recent - baseline, 1)
            if recent is not None and baseline is not None
            else None,
        }

    def public(self) -> dict[str, Any]:
        samples = sorted(self.samples)
        return {
            "requests": self.requests,
            "failures": self.failures,
            "sample_count": len(samples),
            "last_ms": self.samples[-1] if samples else None,
            "p95_ms": self._p95(samples),
        }


@dataclass(slots=True)
class Admission:
    tokens: float
    updated: float
    active: int = 0


class AdminLimiter:
    """Per-admin burst 30, sustained 2/s, at most eight concurrent handlers."""

    def __init__(self) -> None:
        self.users: dict[str, Admission] = {}

    def acquire(self, identity: str, now: float) -> Admission:
        from .access.models import AccessError

        for key, item in list(self.users.items()):
            if not item.active and now - item.updated > 600:
                del self.users[key]
        if identity not in self.users:
            if len(self.users) >= 128:
                raise AccessError("rate_limited")
            self.users[identity] = Admission(30, now)
        item = self.users[identity]
        item.tokens = min(30, item.tokens + max(0, now - item.updated) * 2)
        item.updated = now
        if item.active >= 8 or item.tokens < 1:
            raise AccessError("rate_limited")
        item.tokens -= 1
        item.active += 1
        return item

    @staticmethod
    def release(item: Admission) -> None:
        item.active = max(0, item.active - 1)
