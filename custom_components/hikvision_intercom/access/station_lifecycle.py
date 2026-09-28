"""Read-only lifecycle impact planning; never grants, revokes or deletes a connection."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from .group_permissions import inherited
from .models import AccessError, ManagedUser, build_user, utc_now
from .repository import AccessRepository


def impact(
    repository: AccessRepository,
    source: str,
    target: str | None,
    *,
    target_locks: set[int],
    source_inventory: Any = None,
    target_inventory: Any = None,
    source_observed_at: str | None = None,
    hold_programs: int = 0,
    row_budget: int = 200,
) -> dict[str, Any]:
    """Project desired permissions without copying credentials or device ownership.

    Existing bindings, tombstones and retired credentials remain untouched. This
    is an impact review, not an executable transaction or proof of device cleanup.
    """
    if source == target or not 1 <= row_budget <= 200:
        raise AccessError("invalid_fields")
    repo = repository.preview_copy()
    state = repo.snapshot()
    if len(state["users"]) > 10000:
        raise AccessError("bulk_selection_invalid")
    prior_policy = state["profile_settings"]
    groups = (prior_policy or {}).get("values", {}).get("groups", [])
    projected = deepcopy(state)
    group_rows = []
    for group in (projected["profile_settings"] or {}).get("values", {}).get("groups", []):
        stations = set(group.get("station_ids", []))
        if source not in stations:
            continue
        before = sorted(stations)
        stations.remove(source)
        if target:
            stations.add(target)
        group["station_ids"] = sorted(stations)
        group_rows.append(
            {
                "group_id": group["id"],
                "label": group["label"],
                "enabled": group["enabled"],
                "before": before,
                "after": sorted(stations),
            }
        )

    target_in_use = bool(
        target
        and (
            state["bindings"].get(target)
            or any(target in group.get("station_ids", []) for group in groups)
            or any(
                target in raw["assignments"] or target in raw["permission_overrides"]
                for raw in state["users"].values()
            )
            or any(
                target in item["targets"] and target not in item["confirmed"]
                for kind in ("tombstones", "retired_cards", "retired_pins")
                for item in state[kind].values()
            )
        )
    )
    rows: list[dict[str, Any]] = []
    required_locks: set[int] = set()
    affected, native = 0, 0
    for raw in state["users"].values():
        old = ManagedUser.from_private(raw)
        inherited_source = source in inherited(prior_policy, old.group_ids)
        assignment = old.assignments.get(source)
        native_bound = bool(
            old.access_timing_policy
            and old.access_timing_policy["mode"] == "native"
            and (
                source in old.access_timing_policy["bindings"]
                or bool(assignment and assignment.enabled)
            )
        )
        if not (
            assignment or inherited_source or source in old.permission_overrides or native_bound
        ):
            continue
        affected += 1
        native += int(native_bound)
        if assignment and assignment.enabled:
            required_locks.update(assignment.allowed_locks)
        personal = dict(old.permission_overrides)
        exception = personal.pop(source, None)
        if target and exception is not None and not target_in_use:
            personal[target] = exception
        locks = {}
        if target and assignment and assignment.enabled and not target_in_use:
            locks[target] = sorted(assignment.allowed_locks)
        patch: dict[str, Any] = {"permission_overrides": personal, "door_permissions": locks}
        # Do not merge or overwrite an existing target exception in a blocked review.
        if target_in_use:
            after = None
        else:
            new = build_user(
                repo.permission_data(patch, old, state=projected),
                employee_no=old.employee_no,
                previous=old,
                now=utc_now(),
            )
            after = sorted(sid for sid, item in new.assignments.items() if item.enabled)
        if len(rows) < row_budget:
            rows.append(
                {
                    "user_id": old.id,
                    "display_name": old.display_name,
                    "active": old.active,
                    "source_permission": exception or ("group" if inherited_source else "none"),
                    "locks": sorted(assignment.allowed_locks) if assignment else [],
                    "before": sorted(sid for sid, item in old.assignments.items() if item.enabled),
                    "after": after,
                    "native_schedule": native_bound,
                }
            )

    pending = {
        kind: sum(
            source in item["targets"] and source not in item["confirmed"]
            for item in state[kind].values()
        )
        for kind in ("tombstones", "retired_cards", "retired_pins")
    }
    owned = state["bindings"].get(source, {})
    inventory_users = set(source_inventory.users) if source_inventory is not None else None
    owned_employees = {binding["employee_no"] for binding in owned.values()}
    unknown_owners = len(inventory_users - owned_employees) if inventory_users is not None else None
    blockers = []
    if target_in_use:
        blockers.append("target_already_in_use")
    if target and target_inventory is None:
        blockers.append("target_ownership_unverified")
    elif target and target_inventory.users:
        blockers.append("target_contains_accounts")
    if target and not required_locks <= target_locks:
        blockers.append("target_lock_mapping_incomplete")
    if target and native:
        blockers.append("native_schedule_redeployment_required")
    if hold_programs:
        blockers.append("hold_programs_require_separate_review")
    return {
        "source_id": source,
        "target_id": target,
        "mode": "replacement" if target else "retirement",
        "read_only": True,
        "can_apply": False,
        "device_writes": 0,
        "affected_people": affected,
        "rows": rows,
        "rows_complete": affected <= row_budget,
        "row_budget": row_budget,
        "groups": group_rows,
        "known_bindings": len(owned),
        "pending_cleanup": pending,
        "source_observed_at": source_observed_at,
        "unknown_owners": unknown_owners,
        "hold_programs": hold_programs,
        "native_schedules": native,
        "required_target_locks": sorted(required_locks),
        "blockers": blockers,
        "cleanup_verified": False,
        "source_removal_ready": False,
    }
