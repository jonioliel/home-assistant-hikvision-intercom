"""Validate saved relay permissions before constructing a write-capable client."""

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
