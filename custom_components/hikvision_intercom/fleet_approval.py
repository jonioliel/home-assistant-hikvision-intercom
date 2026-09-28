"""Short-lived second approval of the existing immutable fleet configuration review.

No consent survives a restart, consumes another operator's token, or writes a device.
"""

from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
from time import monotonic
from typing import Any

from .access.models import AccessError
from .operations_center import OperationsCenter, canonical


def fingerprint(review: dict[str, Any]) -> str:
    return sha256(
        canonical(
            {
                key: review[key]
                for key in ("actor", "kind", "revision", "values", "stamp", "expires")
            }
        )
    ).hexdigest()


def current(ops: OperationsCenter, token: str) -> dict[str, Any]:
    review = ops.reviews.get(token)
    if (
        not review
        or review["kind"] != "configuration"
        or review["expires"] <= monotonic()
        or review["revision"] != ops.data["revision"]
    ):
        raise AccessError("review_expired")
    return review


def plan(ops: OperationsCenter, token: str, actor: str, catalog: dict[str, str]) -> dict[str, Any]:
    review = current(ops, token)
    consent = review.get("consent")
    return {
        "review_id": token,
        "fingerprint": fingerprint(review),
        "own_request": review["actor"] == actor,
        "state": "approved"
        if consent and consent["approved"]
        else "rejected"
        if consent
        else "pending",
        "remaining_seconds": max(0, int(review["expires"] - monotonic())),
        "rows": [
            {
                "station_id": row["station_id"],
                "name": catalog.get(row["station_id"], ""),
                "door": row["door"],
                "before": deepcopy(row["expected"]),
                "after": {**deepcopy(row["expected"]), **deepcopy(row["changes"])},
            }
            for row in review["values"]["rows"]
        ],
    }


def decide(ops: OperationsCenter, token: str, actor: str, digest: str, approve: bool) -> None:
    review = current(ops, token)
    if actor == review["actor"]:
        raise AccessError("separate_approver_required")
    if review.get("consent") or digest != fingerprint(review) or type(approve) is not bool:
        raise AccessError("review_expired")
    review["consent"] = {"approver": actor, "fingerprint": digest, "approved": approve}


def check(review: dict[str, Any]) -> str:
    consent = review.get("consent")
    if (
        not consent
        or not consent["approved"]
        or consent["approver"] == review["actor"]
        or consent["fingerprint"] != fingerprint(review)
    ):
        raise AccessError("approval_required")
    if review["expires"] <= monotonic():
        raise AccessError("review_expired")
    return str(consent["approver"])
