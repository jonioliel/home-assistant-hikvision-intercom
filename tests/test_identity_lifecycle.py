"""Identity lifecycle insight coverage."""

from datetime import UTC, datetime, timedelta

import pytest

from custom_components.hikvision_intercom.access.identity_lifecycle import (
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
