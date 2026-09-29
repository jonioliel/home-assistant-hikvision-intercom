"""Durable central policy transfers. Device reconciliation retains its ownership journal."""

from __future__ import annotations

import re
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..client.access import AccessCapabilities, StationInventory
    from .repository import AccessRepository
from uuid import uuid4

from .models import AccessError, ManagedUser, utc_now
from .station_lifecycle import impact

LIMIT = 100
FIELDS = {
    "id",
    "actor",
    "source_id",
    "target_id",
    "definitions",
    "stamp",
    "fingerprint",
    "created_at",
    "expires_at",
    "state",
    "approval",
    "require_approval",
    "applied_at",
    "policy_stamp",
    "user_ids",
    "metadata",
    "metadata_applied",
    "verified_at",
    "removed_at",
    "affected_people",
}
STATES = {"prepared", "rejected", "applied", "verified", "removing", "removed"}


def validate(records: Any) -> None:
    if not isinstance(records, dict) or len(records) > LIMIT:
        raise AccessError("invalid_storage")
    from .models import text_field

    for key, row in records.items():
        if not isinstance(row, dict) or set(row) != FIELDS or row["id"] != key:
            raise AccessError("invalid_storage")
        if not re.fullmatch(r"[a-f0-9]{32}", key) or row["state"] not in STATES:
            raise AccessError("invalid_storage")
        for name in ("actor", "source_id", "stamp", "fingerprint"):
            text_field(row[name], 128)
        if row["target_id"] is not None:
            text_field(row["target_id"], 128)
            if row["target_id"] == row["source_id"]:
                raise AccessError("invalid_storage")
        if type(row["require_approval"]) is not bool or type(row["metadata_applied"]) is not bool:
            raise AccessError("invalid_storage")
        for name in ("created_at", "expires_at", "applied_at", "verified_at", "removed_at"):
            value = row[name]
            if value is None and name not in {"created_at", "expires_at"}:
                continue
            if datetime.fromisoformat(text_field(value, 40)).tzinfo is None:
                raise AccessError("invalid_storage")
        ids = [row["source_id"], *([row["target_id"]] if row["target_id"] else [])]
        if not isinstance(row["definitions"], list) or [d["id"] for d in row["definitions"]] != ids:
            raise AccessError("invalid_storage")
        for definition in row["definitions"]:
            if set(definition) != {"id", "identity", "name", "mappings"}:
                raise AccessError("invalid_storage")
            text_field(definition["identity"], 200)
            text_field(definition["name"], 200)
            if not isinstance(definition["mappings"], list) or len(definition["mappings"]) > 2:
                raise AccessError("invalid_storage")
            for mapping in definition["mappings"]:
                if set(mapping) != {"physical_index", "api_id", "name"} or (
                    type(mapping["physical_index"]) is not int
                    or mapping["physical_index"] not in {1, 2}
                    or type(mapping["api_id"]) is not int
                    or mapping["api_id"] not in {1, 2}
                ):
                    raise AccessError("invalid_storage")
                if mapping["name"] is not None:
                    text_field(mapping["name"], 200)
        if not isinstance(row["user_ids"], list) or len(row["user_ids"]) > 10000:
            raise AccessError("invalid_storage")
        if type(row["affected_people"]) is not int or not 0 <= row["affected_people"] <= 10000:
            raise AccessError("invalid_storage")
        from .models import uuid_text

        if len(set(row["user_ids"])) != len(row["user_ids"]):
            raise AccessError("invalid_storage")
        for uid in row["user_ids"]:
            uuid_text(uid)
        consent = row["approval"]
        if consent is not None:
            if not isinstance(consent, dict) or set(consent) != {
                "actor",
                "fingerprint",
                "approved",
            }:
                raise AccessError("invalid_storage")
            text_field(consent["actor"], 128)
            if (
                consent["actor"] == row["actor"]
                or consent["fingerprint"] != row["fingerprint"]
                or type(consent["approved"]) is not bool
            ):
                raise AccessError("invalid_storage")
        if row["policy_stamp"] is not None:
            text_field(row["policy_stamp"], 128)
        meta = row["metadata"]
        if not isinstance(meta, dict) or set(meta) != {"source", "target"}:
            raise AccessError("invalid_storage")
        from ..operations_center import record

        for value in meta.values():
            if value is not None:
                if (
                    set(value) != {"revision", "values"}
                    or type(value["revision"]) is not int
                    or value["revision"] < 1
                ):
                    raise AccessError("invalid_storage")
                record("stations", value["values"])
        if row["state"] in {"applied", "verified", "removing", "removed"} and not row["applied_at"]:
            raise AccessError("invalid_storage")
        if row["state"] in {"verified", "removing", "removed"} and (
            not row["verified_at"] or not row["metadata_applied"]
        ):
            raise AccessError("invalid_storage")
        if row["state"] == "removed" and not row["removed_at"]:
            raise AccessError("invalid_storage")


def policy_stamp(
    repo: AccessRepository, state: dict[str, Any], source: str, target: str | None
) -> str:
    """Bind only desired policy. Reconciliation progress must not invalidate verification."""
    from .csv_transfer import desired_fields

    relevant = {source, *([target] if target else [])}
    return repo.fingerprint(
        {
            "groups": [
                g
                for g in (state["profile_settings"] or {}).get("values", {}).get("groups", [])
                if relevant.intersection(g["station_ids"])
            ],
            "people": {
                uid: desired_fields(ManagedUser.from_private(raw))
                for uid, raw in state["users"].items()
                if relevant.intersection(raw["assignments"])
                or relevant.intersection(raw["permission_overrides"])
            },
        }
    )


def prepare(
    repo: AccessRepository,
    state: dict[str, Any],
    actor: str,
    source: str,
    target: str | None,
    definitions: list[dict[str, Any]],
    metadata: dict[str, Any],
    require_approval: bool,
    stamp: str,
) -> dict[str, Any]:
    if repo.bulk_stamp(state) != stamp:
        raise AccessError("bulk_review_stale")
    records = state["station_lifecycles"]
    selected = {source, *([target] if target else [])}
    if any(
        r["state"] in {"applied", "verified", "removing"}
        and selected.intersection({r["source_id"], r["target_id"]})
        for r in records.values()
    ):
        raise AccessError("lifecycle_already_applied")
    if len(records) >= LIMIT:
        finalized = [
            r
            for r in records.values()
            if r["state"] in {"removed", "rejected"}
            or (
                r["state"] == "prepared"
                and datetime.fromisoformat(r["expires_at"]) <= datetime.now(UTC)
            )
        ]
        if not finalized:
            raise AccessError("lifecycle_history_full")
        del records[min(finalized, key=lambda r: r["created_at"])["id"]]
    row = {
        "id": uuid4().hex,
        "actor": actor,
        "source_id": source,
        "target_id": target,
        "definitions": deepcopy(definitions),
        "stamp": stamp,
        "fingerprint": "",
        "created_at": utc_now(),
        "expires_at": (datetime.now(UTC) + timedelta(hours=24)).isoformat(),
        "state": "prepared",
        "approval": None,
        "require_approval": require_approval,
        "applied_at": None,
        "policy_stamp": None,
        "user_ids": [],
        "metadata": deepcopy(metadata),
        "metadata_applied": False,
        "verified_at": None,
        "removed_at": None,
        "affected_people": sum(
            source in raw["assignments"] or source in raw["permission_overrides"]
            for raw in state["users"].values()
        ),
    }
    row["fingerprint"] = repo.fingerprint({k: v for k, v in row.items() if k != "fingerprint"})
    records[row["id"]] = row
    validate(records)
    return row


def current(state: dict[str, Any], job_id: str, fingerprint: str | None = None) -> dict[str, Any]:
    row: dict[str, Any] | None = state["station_lifecycles"].get(job_id)
    if not row:
        raise AccessError("lifecycle_not_found")
    if fingerprint is not None and row["fingerprint"] != fingerprint:
        raise AccessError("bulk_review_stale")
    return row


def decide(
    repo: AccessRepository,
    state: dict[str, Any],
    job_id: str,
    actor: str,
    fingerprint: str,
    approve: bool,
) -> dict[str, Any]:
    row = current(state, job_id, fingerprint)
    if actor == row["actor"]:
        raise AccessError("separate_approver_required")
    if (
        row["state"] not in {"prepared", "applied", "verified"}
        or row["approval"]
        or (
            row["state"] == "prepared"
            and datetime.fromisoformat(row["expires_at"]) <= datetime.now(UTC)
        )
    ):
        raise AccessError("review_expired")
    if (row["state"] == "prepared" and row["stamp"] != repo.bulk_stamp(state)) or type(
        approve
    ) is not bool:
        raise AccessError("bulk_review_stale")
    row["approval"] = {"actor": actor, "fingerprint": fingerprint, "approved": approve}
    if not approve and row["state"] == "prepared":
        row["state"] = "rejected"
    return row


def apply(
    repo: AccessRepository,
    state: dict[str, Any],
    job_id: str,
    actor: str,
    fingerprint: str,
    target_locks: set[int],
    validate_user: Any,
) -> dict[str, Any]:
    row = current(state, job_id, fingerprint)
    if row["actor"] != actor:
        raise AccessError("unauthorized")
    if row["state"] in {"applied", "verified", "removed"}:
        return row  # Durable idempotency; never recompute or grant on a duplicate call.
    if row["state"] != "prepared" or datetime.fromisoformat(row["expires_at"]) <= datetime.now(UTC):
        raise AccessError("review_expired")
    if row["stamp"] != repo.bulk_stamp(state):
        raise AccessError("bulk_review_stale")
    if row["require_approval"] and not (row["approval"] and row["approval"]["approved"]):
        raise AccessError("approval_required")
    source, target = row["source_id"], row["target_id"]
    selected = {source, *([target] if target else [])}
    if any(
        r["id"] != row["id"]
        and r["state"] in {"applied", "verified", "removing"}
        and selected.intersection({r["source_id"], r["target_id"]})
        for r in state["station_lifecycles"].values()
    ):
        raise AccessError("lifecycle_already_applied")
    detached = repo.preview_copy()
    detached._state = deepcopy(state)
    from ..client.access import StationInventory

    projection = impact(
        detached,
        source,
        target,
        target_locks=target_locks,
        target_inventory=StationInventory() if target else None,
    )
    if projection["blockers"] or projection["native_schedules"]:
        raise AccessError("lifecycle_blocked")
    old_users = deepcopy(state["users"])
    policy = state["profile_settings"]
    if policy:
        changed_groups = False
        for group in policy["values"]["groups"]:
            if source in group["station_ids"]:
                group["station_ids"] = sorted(
                    (set(group["station_ids"]) - {source}) | ({target} if target else set())
                )
                changed_groups = True
        if changed_groups:
            policy["revision"] += 1
    changed = []
    for uid, raw in old_users.items():
        old = ManagedUser.from_private(raw)
        personal = dict(old.permission_overrides)
        exception = personal.pop(source, None)
        if target and exception is not None:
            personal[target] = exception
        doors = {}
        source_assignment = old.assignments.get(source)
        if target and source_assignment and source_assignment.enabled:
            doors[target] = sorted(source_assignment.allowed_locks)
        patch = {"permission_overrides": personal, "door_permissions": doors}
        proposed = repo.permission_data(patch, old, state=state)
        from .csv_transfer import desired_fields
        from .models import build_user

        after = build_user(proposed, employee_no=old.employee_no, previous=old, now=utc_now())
        if desired_fields(old) != desired_fields(after):
            validate_user(after)
            repo._update_user(state, uid, patch, old.revision)
            changed.append(uid)
    # Ownership, tombstones and retired credential reservations deliberately remain.
    row["user_ids"] = sorted(changed)
    row["affected_people"] = len(changed)
    row["state"], row["applied_at"] = "applied", utc_now()
    row["policy_stamp"] = policy_stamp(repo, state, source, target)
    return row


def frozen_sources(state: dict[str, Any]) -> set[str]:
    return {
        r["source_id"]
        for r in state["station_lifecycles"].values()
        if r["state"] in {"applied", "verified", "removing", "removed"}
    }


def guard(state: dict[str, Any]) -> None:
    frozen = frozen_sources(state)
    if not frozen:
        return
    if any(
        frozen.intersection(raw["assignments"]) or frozen.intersection(raw["permission_overrides"])
        for raw in state["users"].values()
    ) or any(
        frozen.intersection(g["station_ids"])
        for g in (state["profile_settings"] or {}).get("values", {}).get("groups", [])
    ):
        raise AccessError("station_retiring")


def target_verified(
    repo: AccessRepository,
    state: dict[str, Any],
    row: dict[str, Any],
    inventory: StationInventory,
    caps: AccessCapabilities,
) -> bool:
    from .normalize import canonical
    from .validity_transport import owned_utc_echo

    target = row["target_id"]
    # Verify the current desired state, including people edited or deleted after transfer.
    # Fresh unowned accounts and pending cancellations cannot masquerade as completion.
    owned = state["bindings"].get(target, {})
    observed_employees = set(inventory.users) | {c["employeeNo"] for c in inventory.cards.values()}
    if observed_employees - {b["employee_no"] for b in owned.values()}:
        return False
    if any(
        target in value["targets"] and target not in value["confirmed"]
        for kind in ("tombstones", "retired_cards", "retired_pins")
        for value in state[kind].values()
    ):
        return False
    uids = (
        set(row["user_ids"])
        | set(owned)
        | {uid for uid, raw in state["users"].items() if target in raw["assignments"]}
    )
    for uid in uids:
        raw = state["users"].get(uid)
        if not raw:
            if uid in owned:
                return False
            continue
        assignment = raw["assignments"].get(target)
        present = raw["active"] and assignment and assignment["enabled"]
        binding = state["bindings"].get(target, {}).get(uid)
        if not present:
            if raw["employee_no"] in inventory.users or any(
                c["employeeNo"] == raw["employee_no"] for c in inventory.cards.values()
            ):
                return False
            continue
        if not (
            binding
            and binding.get("sync_state") == "synced"
            and not binding.get("intent")
            and assignment["applied_revision"] == raw["revision"]
            and raw["employee_no"] in inventory.users
        ):
            return False
        observed = inventory
        try:
            fingerprint = repo.fingerprint(canonical(observed, raw["employee_no"], caps))
        except AccessError as err:
            if err.code != "validity_timezone_mismatch":
                return False
            recovered = owned_utc_echo(
                observed, raw["employee_no"], caps, repo.fingerprint, {binding.get("fingerprint")}
            )
            if recovered is None:
                return False
            fingerprint = repo.fingerprint(canonical(recovered, raw["employee_no"], caps))
        if fingerprint != binding.get("fingerprint"):
            return False
    return True


def public(row: dict[str, Any], actor: str) -> dict[str, Any]:
    return {
        k: deepcopy(row[k])
        for k in (
            "id",
            "source_id",
            "target_id",
            "state",
            "fingerprint",
            "created_at",
            "expires_at",
            "applied_at",
            "verified_at",
            "removed_at",
            "metadata_applied",
        )
    } | {
        "own_request": row["actor"] == actor,
        "require_approval": row["require_approval"],
        "approval_state": "approved"
        if row["approval"] and row["approval"]["approved"]
        else "rejected"
        if row["approval"]
        else "pending",
        "affected_people": row["affected_people"],
        "source_name": row["definitions"][0]["name"],
        "target_name": row["definitions"][1]["name"] if row["target_id"] else None,
    }
