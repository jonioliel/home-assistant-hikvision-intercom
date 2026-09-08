"""Validate saved relay permissions before constructing a write-capable client."""

import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from .exceptions import HikvisionValidationError


@dataclass(frozen=True, slots=True)
class ManagedLock:
    """Physical relay 1 is the only commissioned output in this installation."""

    physical_index: int
    api_id: int


def managed_locks(data: Mapping[str, Any]) -> tuple[ManagedLock, ...]:
    records = data.get("locks", [])
    if not isinstance(records, list) or len(records) > 1:
        raise HikvisionValidationError("Only the active relay may be managed")
    if not records:
        return ()
    item = records[0]
    if (
        not isinstance(item, dict)
        or type(item.get("physical_index")) is not int
        or item["physical_index"] != 1
        or type(item.get("api_id")) is not int
        or item["api_id"] not in {1, 2}
        or item.get("confirmed") is not True
    ):
        raise HikvisionValidationError("Relay mapping requires physical confirmation")
    return (ManagedLock(1, item["api_id"]),)


@dataclass(frozen=True, slots=True)
class PollOptions:
    idle: float = 2.0
    active: float = 0.75
    pulse: float = 5.0

    @classmethod
    def from_mapping(cls, options: Mapping[str, Any]) -> "PollOptions":
        values: list[float] = []
        for key, default, lower, upper in (
            ("idle_interval", 2.0, 1.5, 30),
            ("active_interval", 0.75, 0.5, 1),
            ("pulse_seconds", 5.0, 1, 30),
        ):
            value = options.get(key, default)
            if (
                type(value) not in (int, float)
                or not math.isfinite(value)
                or not lower <= value <= upper
            ):
                raise HikvisionValidationError("Invalid polling or display duration")
            values.append(float(value))
        return cls(*values)
