import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from test_clock import RULE

from custom_components.hikvision_intercom.client.events import EventClient
from custom_components.hikvision_intercom.clock import device_zone
from custom_components.hikvision_intercom.exceptions import (
    HikvisionUnsupportedError,
    HikvisionValidationError,
)


async def history(
    *,
    firmware="V3.9.0 build 260115",
    changed=False,
    identity="verified",
    wall="2026-09-09 11:34:59",
):
    client = AsyncMock()
    client._expected_identity = "verified"
    client.async_device_info.return_value = (identity, "DS-KV6124-E1", firmware)
    original = {
        "major": 5,
        "minor": 181,
        "time": wall,
        "name": "Demo Resident",
        "employeeNoString": "DEMO01",
    }

    async def response(*args, **kwargs):
        query = json.loads(kwargs["content"])["AcsEventCond"]
        return json.dumps(
            {
                "AcsEvent": {
                    "searchID": query["searchID"],
                    "totalMatches": 1,
                    "numOfMatches": 1,
                    "responseStatusStrg": "OK",
                    "InfoList": [original],
                }
            }
        ).encode()

    client._request.side_effect = response
    ec = EventClient(client)
    ec.page_size = 30
    ec.position_limit = 1000
    zone = device_zone(RULE)
    with patch("custom_components.hikvision_intercom.client.events.ClockClient") as clock_type:
        clock_type.return_value.async_read = AsyncMock(
            side_effect=[{"zone": zone}, {"zone": device_zone("CST-2:00:00") if changed else zone}]
        )
        rows = await ec.async_history(
            datetime(2026, 9, 9, 8, 34, 54, tzinfo=UTC), datetime(2026, 9, 9, 8, 35, 4, tzinfo=UTC)
        )
    assert original["time"] == wall
    return rows


async def test_observed_local_time_is_converted_without_changing_identity():
    row = (await history())[0]
    assert row["time"] == "2026-09-09T08:34:59+00:00"
    assert row["employeeNoString"] == "DEMO01" and row["name"] == "Demo Resident"
    assert row["_time_interpretation"] == "device_local"


@pytest.mark.parametrize("kwargs", [{"firmware": "other"}, {"identity": "replacement"}])
async def test_unverified_firmware_or_replaced_device_cannot_assign_zone(kwargs):
    with pytest.raises(HikvisionUnsupportedError):
        await history(**kwargs)


async def test_changed_zone_rejects_whole_history_snapshot():
    with pytest.raises(HikvisionValidationError):
        await history(changed=True)
