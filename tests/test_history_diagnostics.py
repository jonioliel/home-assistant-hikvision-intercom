import json
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest

from custom_components.hikvision_intercom.client.events import HistoryWindowFull
from custom_components.hikvision_intercom.client.history_diagnostics import inspect_history
from custom_components.hikvision_intercom.exceptions import (
    HikvisionTimeoutError,
    HikvisionValidationError,
)

START = "2026-09-09T08:00:00+00:00"
END = "2026-09-09T09:00:00+00:00"


@pytest.mark.parametrize(
    "start,end", [("2026-09-09T08:00:00", END), (END, START), (START, "2026-09-11T08:00:00Z")]
)
async def test_invalid_range_sends_no_requests(start, end):
    client = AsyncMock()
    with pytest.raises(HikvisionValidationError):
        await inspect_history(client, start, end)
    client.async_confirm_identity.assert_not_called()


@pytest.mark.parametrize(
    "rows,honored",
    [
        ([], None),
        (
            [
                {
                    "major": 5,
                    "minor": 181,
                    "time": "2026-09-09T11:30:00+03:00",
                    "employeeNoString": "PRIVATE_ID",
                    "name": "PRIVATE_NAME",
                    "password": "SECRET",
                }
            ],
            True,
        ),
        ([{"major": 5, "minor": 181, "time": "2026-09-09T11:30:00+00:00"}], False),
    ],
)
async def test_inspection_keeps_absolute_time_and_exports_only_counts(rows, honored):
    with (
        patch(
            "custom_components.hikvision_intercom.client.history_diagnostics.HikvisionClient"
        ) as client_type,
        patch(
            "custom_components.hikvision_intercom.client.history_diagnostics.EventClient"
        ) as event_type,
        patch(
            "custom_components.hikvision_intercom.client.history_diagnostics.ClockClient"
        ) as clock_type,
    ):
        client_type.return_value = AsyncMock()
        events = event_type.return_value = AsyncMock()
        events.async_capabilities.return_value = True
        events.async_history.return_value = rows
        clock_type.return_value.async_read = AsyncMock(
            return_value={"skew_seconds": 28839, "private": "secret"}
        )
        report = await inspect_history(AsyncMock(), START, END)
    assert report["complete"] and report["filter_honored"] is honored
    assert report["records"] == len(rows) and report["live_events_emitted"] == 0
    assert not report["recovery_cursor_changed"]
    encoded = json.dumps(report)
    assert "PRIVATE" not in encoded and "SECRET" not in encoded and "secret" not in encoded
    events.async_history.assert_awaited_once_with(
        datetime.fromisoformat(START), datetime.fromisoformat(END)
    )


async def test_dense_window_does_not_report_empty_success_and_clock_failure_is_separate():
    with (
        patch(
            "custom_components.hikvision_intercom.client.history_diagnostics.HikvisionClient"
        ) as client_type,
        patch(
            "custom_components.hikvision_intercom.client.history_diagnostics.EventClient"
        ) as event_type,
        patch(
            "custom_components.hikvision_intercom.client.history_diagnostics.ClockClient"
        ) as clock_type,
    ):
        client_type.return_value = AsyncMock()
        events = event_type.return_value = AsyncMock()
        events.async_capabilities.return_value = True
        events.async_history.side_effect = HistoryWindowFull("full")
        clock_type.return_value.async_read = AsyncMock(side_effect=HikvisionTimeoutError("private"))
        report = await inspect_history(AsyncMock(), START, END)
    assert report["complete"] is False and report["error"] == "history_window_full"
    assert report["clock_error"] == "clock_read_failed" and report["filter_honored"] is None
