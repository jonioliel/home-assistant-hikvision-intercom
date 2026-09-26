"""Durable latest operation per person/station. No credentials in its public projection."""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from .models import AccessError, ManagedUser, utc_now, uuid_text

MAX_COMPLETED = 1000


def pending_users(state: dict[str, Any], station: str) -> set[str]:
    pending = {
        uid
        for uid, user in state["users"].items()
        if (a := user["assignments"].get(station))
        and (a["sync_state"] != "synced" or a["applied_revision"] != a["desired_revision"])
    }
    pending.update(
        uid
        for uid, b in state["bindings"].get(station, {}).items()
        if b.get("intent") is not None
        or b.get("sync_state") != "synced"
        or station not in state["users"].get(uid, {}).get("assignments", {})
    )
    for collection in ("tombstones", "retired_cards", "retired_pins"):
        pending.update(
            item["user_id"]
            for item in state[collection].values()
            if station in item["targets"] and station not in item["confirmed"]
        )
    return pending


def _intent(state: dict[str, Any], uid: str, station: str) -> str:
    from .csv_transfer import desired_fields

    raw = state["users"].get(uid)
    if raw:
        desired = desired_fields(ManagedUser.from_private(raw))
        desired["assignments"] = desired["assignments"].get(station)
    else:
        desired = {"deleted": True}
    return hmac.new(
        bytes.fromhex(state["fingerprint_key"]),
        json.dumps(desired, sort_keys=True).encode(),
        hashlib.sha256,
    ).hexdigest()


def update(state: dict[str, Any], *, migrated: bool = False) -> None:
    """Called inside the same atomic commit as the desired state and readback."""
    journal = state["sync_operations"]
    stations = set(state["bindings"])
    for user in state["users"].values():
        stations.update(user["assignments"])
    for collection in ("tombstones", "retired_cards", "retired_pins"):
        for item in state[collection].values():
            stations.update(item["targets"])
    pending = {(uid, sid) for sid in stations for uid in pending_users(state, sid)}
    now = utc_now()
    for uid, sid in sorted(pending):
        key = f"{uid}/{sid}"
        signature = _intent(state, uid, sid)
        previous = journal.get(key)
        if (
            previous is None
            or previous["intent"] != signature
            or previous["state"] in {"verified", "settled"}
        ):
            journal[key] = {
                "id": str(uuid4()),
                "user_id": uid,
                "station_id": sid,
                "intent": signature,
                "queued_at": None if migrated else now,
                "updated_at": now,
                "state": "pending",
                "verified_at": None,
            }
        item = journal[key]
        user = state["users"].get(uid, {})
        assignment = user.get("assignments", {}).get(sid, {})
        binding = state["bindings"].get(sid, {}).get(uid, {})
        tombstone = state["tombstones"].get(uid, {}).get("stations", {}).get(sid, {})
        status = (
            tombstone.get("sync_state") or binding.get("sync_state") or assignment.get("sync_state")
        )
        value = "failed" if status in {"error", "conflict"} else "pending"
        if item["state"] != value:
            item.update(state=value, updated_at=now)
    for item in journal.values():
        if (item["user_id"], item["station_id"]) not in pending and item["state"] in {
            "pending",
            "failed",
        }:
            # Pending work disappearing alone is not proof of device readback.
            item.update(state="settled", updated_at=now)
    completed = sorted(
        (key for key, item in journal.items() if item["state"] in {"verified", "settled"}),
        key=lambda key: (journal[key]["updated_at"], key),
        reverse=True,
    )
    for key in completed[MAX_COMPLETED:]:
        del journal[key]


def verified(state: dict[str, Any], uid: str, station: str) -> None:
    """Only repository device-readback paths call this, after all revocations settle."""
    item = state["sync_operations"].get(f"{uid}/{station}")
    if item and item["state"] != "verified" and uid not in pending_users(state, station):
        now = utc_now()
        item.update(state="verified", updated_at=now, verified_at=now)


def public(state: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {key: value for key, value in item.items() if key != "intent"}
        for item in sorted(
            state["sync_operations"].values(), key=lambda item: item["updated_at"], reverse=True
        )
    ]


def pending_age(state: dict[str, Any], station: str) -> int | None:
    users = pending_users(state, station)
    if not users:
        return 0
    times = [state["sync_operations"].get(f"{uid}/{station}", {}).get("queued_at") for uid in users]
    if any(value is None for value in times):
        return None
    return max(
        0,
        int(
            (
                datetime.now(UTC) - min(datetime.fromisoformat(value) for value in times)
            ).total_seconds()
        ),
    )


def validate(value: Any) -> None:
    if not isinstance(value, dict):
        raise AccessError("invalid_storage")
    for key, item in value.items():
        if not isinstance(item, dict) or set(item) != {
            "id",
            "user_id",
            "station_id",
            "intent",
            "queued_at",
            "updated_at",
            "state",
            "verified_at",
        }:
            raise AccessError("invalid_storage")
        uuid_text(item["id"])
        uuid_text(item["user_id"])
        if key != f"{item['user_id']}/{item['station_id']}" or not isinstance(
            item["station_id"], str
        ):
            raise AccessError("invalid_storage")
        if (
            item["state"] not in {"pending", "failed", "verified", "settled"}
            or len(bytes.fromhex(item["intent"])) != 32
        ):
            raise AccessError("invalid_storage")
        for field in ("queued_at", "updated_at", "verified_at"):
            if item[field] is not None and datetime.fromisoformat(item[field]).tzinfo is None:
                raise AccessError("invalid_storage")
        if item["updated_at"] is None or (item["state"] == "verified") != (
            item["verified_at"] is not None
        ):
            raise AccessError("invalid_storage")
