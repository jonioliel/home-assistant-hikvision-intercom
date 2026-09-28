"""Identity lifecycle insight coverage."""

from datetime import UTC, datetime, timedelta

import pytest

from custom_components.hikvision_intercom.access.identity_lifecycle import (
    MAX_ROWS,
    candidate_matches,
    report,
)
from custom_components.hikvision_intercom.access.models import AccessError, build_user

NOW = datetime(2026, 9, 23, 9, 0, tzinfo=UTC)


def user(number: int, name: str, **changes):
    data = {
        "display_name": name,
        "employee_no": str(number),
        "phone": "",
        "active": True,
        "cards": [],
        "pin": None,
        "assignments": {},
        **changes,
    }
    return build_user(data, employee_no=str(number), now=NOW.isoformat())


def test_report_finds_expiry_credentials_and_privacy_safe_duplicates():
    first = user(
        1001,
        "  Dana   Cohen ",
        phone="050-123-4567",
        pin="123456",
        cards=[{"card_no": "11112222", "label": "", "enabled": True}],
        valid_from=(NOW - timedelta(days=10)).isoformat(),
        valid_until=(NOW + timedelta(days=4)).isoformat(),
    )
    second = user(
        1002,
        "dana cohen",
        phone="0501234567",
        cards=[{"card_no": "99992222", "label": "", "enabled": True}],
        valid_from=(NOW - timedelta(days=10)).isoformat(),
        valid_until=(NOW - timedelta(seconds=1)).isoformat(),
    )
    third = user(1003, "No Credential")

    result = report([first, second, third], warning_days=7, now=NOW)

    assert result["summary"] == {
        "total": 3,
        "active": 3,
        "scheduled": 0,
        "expired": 1,
        "expiring": 1,
        "without_credentials": 1,
        "duplicate_groups": 3,
        "duplicate_users": 2,
    }
    assert {item["reason"] for item in result["duplicates"]} == {
        "display_name",
        "phone",
        "card_last4",
    }
    assert [item["state"] for item in result["expirations"]] == ["expired", "expiring"]
    assert result["without_credentials"][0]["display_name"] == "No Credential"
    wire = str(result)
    assert "123456" not in wire and "11112222" not in wire and "99992222" not in wire
    assert "•••• 2222" in wire


def test_candidate_matches_excludes_current_user_and_never_returns_secrets():
    first = user(
        1001,
        "Dana Cohen",
        phone="050-123-4567",
        pin="123456",
        cards=[{"card_no": "11112222", "label": "", "enabled": True}],
    )
    second = user(1002, "Other")

    result = candidate_matches(
        [first, second],
        {
            "employee_no": "9000",
            "display_name": " dana  cohen ",
            "phone": "0501234567",
            "card_suffixes": ["2222"],
        },
        exclude_user_id=second.id,
    )

    assert result["total"] == 1 and not result["blocking"]
    assert result["matches"][0]["reasons"] == ["display_name", "phone", "card_last4"]
    assert result["matches"][0]["card_matches"] == ["•••• 2222"]
    assert "123456" not in str(result) and "11112222" not in str(result)


def test_employee_collision_is_blocking_and_inputs_are_bounded():
    existing = user(1001, "Dana")
    result = candidate_matches(
        [existing],
        {"employee_no": "1001", "display_name": "Other", "phone": "", "card_suffixes": []},
    )
    assert result["blocking"] and result["matches"][0]["reasons"] == ["employee_no"]

    with pytest.raises(AccessError, match="invalid_fields"):
        report([existing], warning_days=0, now=NOW)
    with pytest.raises(AccessError, match="invalid_fields"):
        candidate_matches([existing], {"card_suffixes": ["22"]})


@pytest.mark.parametrize("category", ["visitor", "contractor"])
@pytest.mark.parametrize(
    "start_delta,end_delta,active,state,expiring",
    [
        (-1, 1, True, "active", True),
        (0, 40, True, "active", False),
        (1, 2, True, "upcoming", False),
        (-1, 0, True, "expired", False),
        (-2, -1, False, "inactive", False),
    ],
)
def test_temporary_lifecycle_uses_outer_validity_and_respects_disabled_people(
    category, start_delta, end_delta, active, state, expiring
):
    temporary = user(
        5001,
        "Temporary person",
        access_category=category,
        responsible_person="Reception",
        access_purpose="Visit",
        active=active,
        pin="987654",
        cards=[{"card_no": "12345555", "enabled": True}],
        valid_from=(NOW + timedelta(days=start_delta)).isoformat(),
        valid_until=(NOW + timedelta(days=end_delta)).isoformat(),
    )
    result = report([temporary, user(5002, "Staff")], now=NOW)
    row = result["temporary_access"]["users"][0]
    assert row["state"] == state and row["expiring_soon"] is expiring
    assert row["revision"] == temporary.revision
    assert not row["timing_policy_configured"]
    summary = result["temporary_access"]["summary"]
    assert summary["total"] == 1 and summary[state] == 1
    assert summary["expiring"] == int(expiring)
    assert "987654" not in str(result) and "12345555" not in str(result)
    if end_delta == 0:
        assert result["expirations"][0]["state"] == "expired"


def test_temporary_report_is_bounded_but_counts_and_sorts_all_records():
    records = [
        user(
            5000 + index,
            f"Visitor {index}",
            access_category="visitor",
            responsible_person="Reception",
            valid_from=(NOW - timedelta(days=1)).isoformat(),
            valid_until=(NOW + timedelta(hours=index + 1)).isoformat(),
        )
        for index in range(MAX_ROWS + 3)
    ]
    result = report(reversed(records), now=NOW)
    temporary = result["temporary_access"]
    assert temporary["summary"]["total"] == MAX_ROWS + 3
    assert temporary["summary"]["active"] == MAX_ROWS + 3
    assert len(temporary["users"]) == MAX_ROWS
    assert temporary["users"][0]["id"] == records[0].id
    assert temporary["users"][-1]["id"] == records[MAX_ROWS - 1].id
    assert result["truncated"]["temporary_access"]
