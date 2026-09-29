"""Binding-kernel checks; these do not certify a registered portal or authentication."""

from copy import deepcopy

import pytest

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.renewal_identity import (
    checked,
    defaults,
    plan_binding,
    recheck,
    resolve,
)


def test_explicit_one_to_one_binding_does_not_mutate_review_source():
    initial = defaults()
    value = plan_binding(initial, 0, "verified-account", "person-one")
    assert initial == defaults()
    assert resolve(value, "verified-account") == {
        "actor": "verified-account",
        "user_id": "person-one",
        "generation": 1,
    }
    with pytest.raises(AccessError, match="renewal_identity_in_use"):
        plan_binding(value, 1, "other-account", "person-one")
    with pytest.raises(AccessError, match="renewal_identity_unlinked"):
        resolve(value, "other-account")


def test_unlink_relink_and_replacement_invalidate_pending_binding():
    first = plan_binding(defaults(), 0, "account", "one")
    captured = resolve(first, "account")
    recheck(first, captured)
    removed = plan_binding(first, 1, "account", None)
    for changed in [
        removed,
        plan_binding(removed, 2, "account", "one"),
        plan_binding(first, 1, "account", "two"),
    ]:
        with pytest.raises(AccessError, match="renewal_identity_changed"):
            recheck(changed, captured)


def test_unrelated_account_update_does_not_revoke_unchanged_binding():
    first = plan_binding(defaults(), 0, "account", "one")
    captured = resolve(first, "account")
    second = plan_binding(first, 1, "other", "two")
    recheck(second, captured)
    assert plan_binding(second, 2, "account", "one") == second
    with pytest.raises(AccessError, match="revision_conflict"):
        plan_binding(second, 1, "account", None)


@pytest.mark.parametrize(
    "corrupt",
    [
        lambda v: v.update(schema=True),
        lambda v: v.update(revision=True),
        lambda v: v["bindings"]["account"].update(generation=True),
        lambda v: v["bindings"]["account"].update(pin="secret"),
        lambda v: v["bindings"].update(other=deepcopy(v["bindings"]["account"])),
    ],
)
def test_malformed_binding_journals_fail_closed(corrupt):
    value = plan_binding(defaults(), 0, "account", "one")
    corrupt(value)
    with pytest.raises(AccessError, match="invalid_storage"):
        checked(value)


@pytest.mark.parametrize(
    "captured",
    [
        {},
        {"actor": "account", "user_id": "other", "generation": 1},
        {"actor": "account", "user_id": "one", "generation": True},
        {"actor": "account", "user_id": "one", "generation": 1, "token": "secret"},
    ],
)
def test_invalid_or_forged_binding_is_not_an_approval_proof(captured):
    value = plan_binding(defaults(), 0, "account", "one")
    with pytest.raises(AccessError, match="renewal_identity_changed"):
        recheck(value, captured)
