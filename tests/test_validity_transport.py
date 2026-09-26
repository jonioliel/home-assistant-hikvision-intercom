from unittest.mock import AsyncMock, patch

import pytest

from custom_components.smplwise_access_control.access.models import AccessError
from custom_components.smplwise_access_control.access.validity_transport import local_validity
from custom_components.smplwise_access_control.exceptions import HikvisionValidationError


@pytest.mark.parametrize(
    ("date", "expected"), [("2026-01-10", "11:00:00"), ("2026-07-10", "12:00:00")]
)
async def test_local_validity_uses_rules_at_target_date(date, expected):
    clock = {
        "zone": {"kind": "iana", "name": "Asia/Jerusalem"},
        "measurement": {
            "status": "measured",
            "estimated_skew_seconds": 0,
            "uncertainty_seconds": 1,
        },
    }
    with patch(
        "custom_components.smplwise_access_control.client.clock.ClockClient.async_read",
        AsyncMock(return_value=clock),
    ):
        result = await local_validity(
            object(),
            {
                "enable": True,
                "timeType": "UTC",
                "beginTime": date + "T09:00:00+00:00",
                "endTime": date + "T10:00:00+00:00",
            },
        )
    assert result["beginTime"] == date + "T" + expected
    assert result["timeType"] == "local"


async def test_local_validity_rejects_dst_repeated_hour():
    clock = {
        "zone": {"kind": "iana", "name": "Europe/Berlin"},
        "measurement": {
            "status": "measured",
            "estimated_skew_seconds": 0,
            "uncertainty_seconds": 1,
        },
    }
    with patch(
        "custom_components.smplwise_access_control.client.clock.ClockClient.async_read",
        AsyncMock(return_value=clock),
    ):
        with pytest.raises((AccessError, HikvisionValidationError)):
            await local_validity(
                object(),
                {
                    "enable": True,
                    "timeType": "UTC",
                    "beginTime": "2026-10-25T00:15:00+00:00",
                    "endTime": "2026-10-25T00:45:00+00:00",
                },
            )


async def test_local_validity_rejects_untrusted_clock():
    clock = {
        "zone": {"kind": "iana", "name": "UTC"},
        "measurement": {
            "status": "measured",
            "estimated_skew_seconds": 60,
            "uncertainty_seconds": 1,
        },
    }
    with patch(
        "custom_components.smplwise_access_control.client.clock.ClockClient.async_read",
        AsyncMock(return_value=clock),
    ):
        with pytest.raises(AccessError, match="schedule_station_clock_unverified"):
            await local_validity(
                object(),
                {
                    "enable": True,
                    "timeType": "UTC",
                    "beginTime": "2026-10-25T00:15:00+00:00",
                    "endTime": "2026-10-25T00:45:00+00:00",
                },
            )
