"""Reports count retained authentication events separately from unlocking records."""

from datetime import timedelta

import pytest
from test_events import NOW, normalized, payload

from custom_components.hikvision_intercom.events import EventCache
from custom_components.hikvision_intercom.exceptions import HikvisionValidationError
from custom_components.hikvision_intercom.reporting import event_report


def test_reports_do_not_count_unlock_as_second_authentication():
    rows = [normalized(payload(181)), normalized(payload(214)), normalized(payload(150))]
    rows[1]["recovered"] = True
    report = event_report(rows, NOW)
    assert report["totals"] == {
        "records": 3,
        "authentication": 2,
        "granted": 1,
        "denied": 1,
        "unknown": 0,
        "other": 1,
        "recovered": 1,
    }
    assert report["methods"] == {"pin": 2}
    assert report["by_station"][0]["records"] == 3
    assert report["day_timezone"] == "UTC"


def test_report_utc_days_and_empty_counts_are_explicit():
    first = normalized(payload(181))
    first["timestamp"] = "2026-09-08T01:30:00+03:00"
    last = normalized(payload(150))
    last["timestamp"] = "2026-09-08T02:30:00Z"
    report = event_report([first, last], NOW)
    assert [row["day"] for row in report["by_day"]] == ["2026-09-07", "2026-09-08"]
    assert report["oldest"] == "2026-09-07T22:30:00+00:00"
    empty = event_report([], NOW)
    assert empty["totals"]["records"] == 0 and empty["oldest"] is None and not empty["by_station"]


def test_all_records_uses_same_filters_and_retention_without_page_truncation():
    cache = EventCache()
    for i in range(260):
        row = normalized(payload(181 if i % 2 else 150, serialNo=i))
        row["station_id"] = "a" if i < 250 else "b"
        assert cache.add(row, NOW)
    page = cache.query({"station_id": "a"}, NOW)
    assert len(page["records"]) == 100 and page["next"]
    all_rows = cache.query({"station_id": "a", "result": "denied"}, NOW, all_records=True)
    assert len(all_rows["records"]) == 125 and all_rows["next"] is None
    with pytest.raises(HikvisionValidationError):
        cache.query({"unknown": "x"}, NOW, all_records=True)
    assert not cache.query({}, NOW + timedelta(days=31), all_records=True)["records"]
