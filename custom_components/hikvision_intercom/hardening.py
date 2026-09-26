"""Bounded runtime metrics and administrator request admission."""

from __future__ import annotations

import re
from collections import deque
from dataclasses import dataclass
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

    def record(self, elapsed: float, failed: bool) -> None:
        self.requests += 1
        self.failures += int(failed)
        self.samples.append(round(max(0, elapsed) * 1000, 1))

    def public(self) -> dict[str, Any]:
        samples = sorted(self.samples)
        return {
            "requests": self.requests,
            "failures": self.failures,
            "sample_count": len(samples),
            "last_ms": self.samples[-1] if samples else None,
            "p95_ms": samples[min(len(samples) - 1, int(len(samples) * 0.95))] if samples else None,
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
