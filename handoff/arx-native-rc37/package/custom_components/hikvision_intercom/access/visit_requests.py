"""Two-person visit decisions and activation guards inside the user transaction."""

from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from .models import AccessError, ManagedUser, text_field, utc_now, uuid_text, valid_period
from .user_timing import timing_draft

LIMIT = 1000
STATUSES = {"pending", "approved", "rejected", "cancelled", "superseded"}
FIELDS = {
    "id",
    "user_id",
    "user_revision",
    "approver_id",
    "requested_by",
    "requested_at",
    "sequence",
    "revision",
    "status",
    "decided_by",
    "decided_at",
    "reason_code",
    "activated_revision",
    "snapshot",
}
SNAPSHOT_FIELDS = {
    "display_name",
    "employee_no",
    "access_category",
    "responsible_person",
    "access_purpose",
    "valid_from",
    "valid_until",
    "pin_configured",
    "enabled_cards",
    "doors",
    "timing_schedule",
}


def snapshot(user: ManagedUser) -> dict[str, Any]:
    return {
        "display_name": user.display_name,
        "employee_no": user.employee_no,
        "access_category": user.access_category,
        "responsible_person": user.responsible_person,
        "access_purpose": user.access_purpose,
        "valid_from": user.valid_from,
        "valid_until": user.valid_until,
        "pin_configured": user.pin is not None,
        "enabled_cards": sum(card.enabled for card in user.cards),
        "doors": {
            sid: sorted(item.allowed_locks)
            for sid, item in user.assignments.items()
            if item.enabled
        },
        "timing_schedule": deepcopy(user.access_timing_policy["schedule"])
        if user.access_timing_policy
        else None,
    }


def latest(state: dict[str, Any], user_id: str) -> dict[str, Any] | None:
    return max(
        (row for row in state["visit_requests"]["items"].values() if row["user_id"] == user_id),
        key=lambda row: row["sequence"],
        default=None,
    )


def latest_by_user(items: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for row in items.values():
        existing = result.get(row["user_id"])
        if existing is None or existing["sequence"] < row["sequence"]:
            result[row["user_id"]] = row
    return result


def validate(data: Any, users: dict[str, Any]) -> None:
    try:
        if (
            not isinstance(data, dict)
            or set(data) != {"revision", "items"}
            or type(data["revision"]) is not int
            or data["revision"] < 0
            or not isinstance(data["items"], dict)
            or len(data["items"]) > LIMIT
        ):
            raise ValueError
        sequences = set()
        for identity, row in data["items"].items():
            if not isinstance(row, dict) or set(row) != FIELDS or uuid_text(identity) != row["id"]:
                raise ValueError
            uuid_text(row["user_id"])
            for key in ("user_revision", "revision", "sequence"):
                if type(row[key]) is not int or row[key] < 1:
                    raise ValueError
            if row["sequence"] > data["revision"] or row["sequence"] in sequences:
                raise ValueError
            sequences.add(row["sequence"])
            for key in ("approver_id", "requested_by"):
                text_field(row[key], 128)
            if row["approver_id"] == row["requested_by"]:
                raise ValueError
            requested_at = datetime.fromisoformat(text_field(row["requested_at"], 40))
            if requested_at.tzinfo is None or row["status"] not in STATUSES:
                raise ValueError
            if row["status"] == "pending":
                if (
                    row["decided_by"]
                    or row["decided_at"]
                    or row["reason_code"]
                    or row["activated_revision"] is not None
                ):
                    raise ValueError
            else:
                text_field(row["decided_by"], 128)
                decided_at = datetime.fromisoformat(text_field(row["decided_at"], 40))
                if decided_at.tzinfo is None or decided_at < requested_at:
                    raise ValueError
                expected = {
                    "approved": "approved",
                    "rejected": "visit_rejected",
                    "cancelled": "visit_cancelled",
                    "superseded": "replaced",
                }[row["status"]]
                if row["reason_code"] != expected:
                    raise ValueError
                if row["status"] == "approved":
                    if (
                        row["decided_by"] != row["approver_id"]
                        or type(row["activated_revision"]) is not int
                        or row["activated_revision"] != row["user_revision"] + 1
                    ):
                        raise ValueError
                elif row["activated_revision"] is not None:
                    raise ValueError
            saved = row["snapshot"]
            if not isinstance(saved, dict) or set(saved) != SNAPSHOT_FIELDS:
                raise ValueError
            for key, maximum in (
                ("display_name", 32),
                ("employee_no", 32),
                ("responsible_person", 64),
                ("access_purpose", 128),
            ):
                text_field(saved[key], maximum, empty=key == "access_purpose")
            if saved["access_category"] not in {"visitor", "contractor"}:
                raise ValueError
            valid_period(saved["valid_from"], saved["valid_until"])
            if (
                saved["valid_until"] is None
                or type(saved["pin_configured"]) is not bool
                or type(saved["enabled_cards"]) is not int
                or saved["enabled_cards"] < 0
            ):
                raise ValueError
            if not isinstance(saved["doors"], dict) or len(saved["doors"]) > 100:
                raise ValueError
            for sid, locks in saved["doors"].items():
                text_field(sid, 64)
                if (
                    not isinstance(locks, list)
                    or not locks
                    or len(locks) > 2
                    or any(type(lock) is not int or lock not in {1, 2} for lock in locks)
                    or len(set(locks)) != len(locks)
                ):
                    raise ValueError
            timing_draft(saved["timing_schedule"])
            user = users.get(row["user_id"])
            if (
                user
                and row["status"] == "approved"
                and user["revision"] < row["activated_revision"]
            ):
                raise ValueError
        # A corrupt pending request must not start up as an active grant.
        current_requests = latest_by_user(data["items"])
        for user_id, user in users.items():
            current = current_requests.get(user_id)
            if current and user["active"] and current["status"] != "approved":
                raise ValueError
    except (ValueError, TypeError, KeyError, AccessError, OverflowError):
        raise AccessError("invalid_storage") from None


def guard_activation(before: dict[str, Any], after: dict[str, Any]) -> None:
    current_requests = latest_by_user(after["visit_requests"]["items"])
    for user_id, user in after["users"].items():
        if not user["active"] or before["users"].get(user_id, {}).get("active"):
            continue
        request = current_requests.get(user_id)
        if request and (
            request["status"] != "approved" or request["activated_revision"] != user["revision"]
        ):
            raise AccessError("visit_approval_required")


def create(state: dict[str, Any], user: ManagedUser, actor: str, approver: str) -> dict[str, Any]:
    actor, approver = text_field(actor, 128), text_field(approver, 128)
    if actor == approver:
        raise AccessError("visit_second_operator_required")
    if user.access_category not in {"visitor", "contractor"}:
        raise AccessError("temporary_user_required")
    if user.active:
        raise AccessError("visit_inactive_required")
    if not user.valid_until or datetime.fromisoformat(user.valid_until) <= datetime.now(UTC):
        raise AccessError("invalid_validity")
    if not any(item.enabled for item in user.assignments.values()) or not (
        user.pin or any(card.enabled for card in user.cards)
    ):
        raise AccessError("guest_credential_required")
    database = state["visit_requests"]
    prior = latest(state, user.id)
    if prior and prior["status"] == "pending":
        prior.update(
            status="superseded",
            decided_by=actor,
            decided_at=utc_now(),
            reason_code="replaced",
            revision=prior["revision"] + 1,
        )
    # Keep the latest decision for every surviving user; remove only old closed history.
    current_ids = {
        row["id"] for uid, row in latest_by_user(database["items"]).items() if uid in state["users"]
    }
    removable = sorted(
        (
            row
            for row in database["items"].values()
            if row["status"] != "pending" and row["id"] not in current_ids
        ),
        key=lambda row: row["sequence"],
    )
    while len(database["items"]) >= LIMIT and removable:
        del database["items"][removable.pop(0)["id"]]
    if len(database["items"]) >= LIMIT:
        raise AccessError("visit_request_limit")
    database["revision"] += 1
    row = {
        "id": str(uuid4()),
        "user_id": user.id,
        "user_revision": user.revision,
        "approver_id": approver,
        "requested_by": actor,
        "requested_at": utc_now(),
        "sequence": database["revision"],
        "revision": 1,
        "status": "pending",
        "decided_by": "",
        "decided_at": None,
        "reason_code": "",
        "activated_revision": None,
        "snapshot": snapshot(user),
    }
    database["items"][row["id"]] = row
    return deepcopy(row)


def prepare_decision(
    state: dict[str, Any], request_id: str, revision: int, actor: str, decision: str
) -> tuple[dict[str, Any], ManagedUser | None]:
    row = state["visit_requests"]["items"].get(request_id)
    if row is None:
        raise AccessError("visit_request_not_found")
    if type(revision) is not int or row["revision"] != revision:
        raise AccessError("revision_conflict")
    current_request = latest(state, row["user_id"])
    if row["status"] != "pending" or current_request is None or current_request["id"] != request_id:
        raise AccessError("visit_request_closed")
    if decision not in {"approve", "reject", "cancel"}:
        raise AccessError("invalid_fields")
    if decision == "cancel":
        if actor not in {row["requested_by"], row["approver_id"]}:
            raise AccessError("unauthorized")
    elif actor != row["approver_id"] or actor == row["requested_by"]:
        raise AccessError("unauthorized")
    raw = state["users"].get(row["user_id"])
    if raw is None and decision == "approve":
        raise AccessError("user_not_found")
    user = ManagedUser.from_private(raw) if raw else None
    if decision == "approve" and (
        user is None or user.active or user.revision != row["user_revision"]
    ):
        raise AccessError("visit_request_stale")
    if (
        decision == "approve"
        and user is not None
        and (not user.valid_until or datetime.fromisoformat(user.valid_until) <= datetime.now(UTC))
    ):
        raise AccessError("invalid_validity")
    row.update(
        status={"approve": "approved", "reject": "rejected", "cancel": "cancelled"}[decision],
        decided_by=actor,
        decided_at=utc_now(),
        reason_code={
            "approve": "approved",
            "reject": "visit_rejected",
            "cancel": "visit_cancelled",
        }[decision],
        revision=revision + 1,
    )
    state["visit_requests"]["revision"] += 1
    return row, user


def public(
    state: dict[str, Any],
    *,
    offset: int = 0,
    limit: int = 100,
    filters: dict[str, Any] | None = None,
    actor: str = "",
) -> dict[str, Any]:
    if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 200:
        raise AccessError("invalid_fields")
    criteria = {} if filters is None else filters
    if not isinstance(criteria, dict) or set(criteria) - {"status", "scope", "query"}:
        raise AccessError("invalid_fields")
    status, scope = criteria.get("status", "all"), criteria.get("scope", "all")
    if (
        not isinstance(status, str)
        or status not in STATUSES | {"all"}
        or not isinstance(scope, str)
        or scope not in {"all", "approver", "requester"}
    ):
        raise AccessError("invalid_fields")
    search = text_field(criteria.get("query", ""), 128, empty=True).casefold()
    if scope != "all":
        text_field(actor, 128)

    def matches(row: dict[str, Any]) -> bool:
        return (
            (status == "all" or row["status"] == status)
            and (
                scope == "all"
                or row["approver_id" if scope == "approver" else "requested_by"] == actor
            )
            and (
                not search
                or search
                in " ".join(
                    str(row["snapshot"].get(key) or "")
                    for key in (
                        "display_name",
                        "employee_no",
                        "responsible_person",
                        "access_purpose",
                    )
                ).casefold()
            )
        )

    rows = sorted(
        (row for row in state["visit_requests"]["items"].values() if matches(row)),
        key=lambda row: row["sequence"],
        reverse=True,
    )
    if filters is not None:
        offset = min(offset, ((len(rows) - 1) // limit) * limit if rows else 0)
    projected = []
    for row in rows[offset : offset + limit]:
        user = state["users"].get(row["user_id"])
        projected.append(
            {
                **deepcopy(row),
                "stale": bool(
                    user and user["revision"] != row["user_revision"] and row["status"] == "pending"
                ),
                "user_deleted": user is None,
            }
        )
    return {
        "revision": state["visit_requests"]["revision"],
        "items": projected,
        "total": len(rows),
        "offset": offset,
        "next_offset": offset + limit if offset + limit < len(rows) else None,
        "filters": {"status": status, "scope": scope, "query": search},
    }
