from copy import deepcopy
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom import fleet_approval
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.operations_center import OperationsCenter


def review():
    ops = OperationsCenter(AsyncMock())
    token = ops.review(
        "owner",
        "configuration",
        {
            "rows": [
                {
                    "station_id": "station",
                    "door": 1,
                    "expected": {"openDuration": 5},
                    "changes": {"openDuration": 7},
                    "identity_stamp": "verified-device",
                }
            ]
        },
        "fleet-identity",
    )
    return ops, token


def test_review_is_read_only_and_consent_is_separate_and_bound_to_exact_plan():
    ops, token = review()
    before = deepcopy(ops.data)
    plan = fleet_approval.plan(ops, token, "second", {"station": "Lobby"})
    assert not plan["own_request"] and plan["rows"][0]["name"] == "Lobby"
    assert plan["rows"][0]["before"]["openDuration"] == 5
    assert plan["rows"][0]["after"]["openDuration"] == 7
    with pytest.raises(AccessError, match="approval_required"):
        fleet_approval.check(ops.reviews[token])
    with pytest.raises(AccessError, match="separate_approver_required"):
        fleet_approval.decide(ops, token, "owner", plan["fingerprint"], True)
    with pytest.raises(AccessError, match="review_expired"):
        fleet_approval.decide(ops, token, "second", "changed-fingerprint", True)
    fleet_approval.decide(ops, token, "second", plan["fingerprint"], True)
    assert fleet_approval.check(ops.reviews[token]) == "second"
    assert ops.data == before
    with pytest.raises(AccessError, match="review_expired"):
        fleet_approval.decide(ops, token, "third", plan["fingerprint"], True)


@pytest.mark.parametrize(
    "mutation", ["identity", "settings", "rows", "expiry", "restart", "rejection"]
)
def test_consent_cannot_survive_a_changed_plan_or_expiry(mutation):
    ops, token = review()
    plan = fleet_approval.plan(ops, token, "second", {})
    fleet_approval.decide(ops, token, "second", plan["fingerprint"], mutation != "rejection")
    record = ops.reviews[token]
    if mutation == "identity":
        record["stamp"] = "different-device"
    elif mutation == "settings":
        ops.data["revision"] += 1
    elif mutation == "rows":
        record["values"]["rows"][0]["changes"]["openDuration"] = 20
    elif mutation == "expiry":
        record["expires"] = 0
    elif mutation == "restart":
        ops = OperationsCenter(AsyncMock())
    with pytest.raises(AccessError, match="review_expired|approval_required"):
        fleet_approval.check(fleet_approval.current(ops, token))


def test_only_owner_consumes_once_and_rejected_consent_never_becomes_authority():
    ops, token = review()
    plan = fleet_approval.plan(ops, token, "second", {})
    fleet_approval.decide(ops, token, "second", plan["fingerprint"], True)
    with pytest.raises(AccessError):
        ops.consume("second", token, "configuration", True, "fleet-identity")
    assert token in ops.reviews
    values = ops.consume("owner", token, "configuration", True, "fleet-identity")
    assert values["rows"][0]["changes"]["openDuration"] == 7
    with pytest.raises(AccessError):
        ops.consume("owner", token, "configuration", True, "fleet-identity")
