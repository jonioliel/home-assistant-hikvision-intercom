"""Current membership reports require observed ownership and retain complete exports."""

import csv
import io
from datetime import timedelta

import pytest
from test_events import NOW, normalized, payload

from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.events import EventCache
from custom_components.hikvision_intercom.exceptions import HikvisionValidationError
from custom_components.hikvision_intercom.reporting import audience_filter, build_report

POLICY = {"groups": [{"id": "staff"}], "fields": [{"id": "department"}]}


def context(row):
    return {
        (row["station_id"], row["employee_no"]): {
            "observed_at": (NOW - timedelta(days=1)).isoformat(),
            "group_ids": ["staff"],
            "profile": {"department": "0007"},
        }
    }


def test_current_membership_requires_exact_identity_time_and_station():
    row = normalized(payload(181, employeeNoString="00042", name="Resident"))
    base, match = audience_filter(
        {"current_group": "staff", "current_profile": {"department": "0007"}, "result": "granted"},
        POLICY,
        context(row),
    )
    assert base == {"result": "granted"} and match(row)
    for change in (
        {"employee_no": "42"},
        {"employee_no": None},
        {"station_id": "another"},
        {"time_source": "received"},
        {"timestamp": (NOW - timedelta(days=2)).isoformat()},
    ):
        assert not match({**row, **change})
    _, changed = audience_filter({"current_profile": {"department": "7"}}, POLICY, context(row))
    assert not changed(row)
    audience = context(row)
    audience[next(iter(audience))]["group_ids"] = []
    _, moved = audience_filter({"current_group": "staff"}, POLICY, audience)
    assert not moved(row)


@pytest.mark.parametrize(
    "filters",
    [
        {"current_group": "removed"},
        {"current_group": []},
        {"current_group": None},
        {"current_profile": {}},
        {"current_profile": []},
        {"current_profile": {"removed": "a"}},
        {"current_profile": {"department": 3}},
        {"current_profile": {"department": ""}},
        {"current_profile": {"department": "a" * 101}},
    ],
)
def test_invalid_membership_filters_do_not_widen_a_report(filters):
    with pytest.raises(HikvisionValidationError):
        audience_filter(filters, POLICY, {})


def test_all_print_records_match_csv_even_beyond_loaded_page():
    cache = EventCache()
    sample = normalized(payload(181, employeeNoString="00042"))
    base, match = audience_filter({"current_group": "staff"}, POLICY, context(sample))
    for i in range(350):
        row = normalized(
            payload(181, employeeNoString="00042" if i % 2 else "unbound", serialNo=5000 + i)
        )
        cache.add(row, NOW)
    first = cache.query(base, NOW, match=match)
    assert len(first["records"]) == 100 and first["next"]
    remaining = cache.query({**base, "before": first["next"]}, NOW, match=match)
    assert len(remaining["records"]) == 75 and remaining["next"] is None
    rows = cache.query(base, NOW, match=match, all_records=True)["records"]
    report = build_report(rows, NOW, {}, True, printable=True)
    exported = list(csv.DictReader(io.StringIO(report["csv"].removeprefix("\ufeff"))))
    assert report["totals"]["records"] == len(report["print_records"]) == len(exported) == 175
    for printed, csv_row in zip(report["print_records"], exported, strict=True):
        assert printed["timestamp"] == csv_row["timestamp"]
        assert printed["display_timestamp"] == csv_row["display_timestamp"]
        assert "id" not in printed and "source" not in printed


async def test_repository_membership_snapshot_excludes_secrets_legacy_and_pending_bindings():
    async def save(_):
        pass

    repo = AccessRepository(save)
    first = await repo.async_create(
        {"display_name": "Owner", "employee_no": "00042", "pin": "123456"}
    )
    second = await repo.async_create({"display_name": "Pending", "employee_no": "00043"})
    await repo.async_bind("station", first.id, fingerprint="verified")
    await repo.async_bind("station", second.id, fingerprint=None)
    snap = repo.event_audience()
    assert list(snap) == [("station", "00042")]
    assert "123456" not in str(snap) and "Owner" not in str(snap)
    snap[("station", "00042")]["profile"]["department"] = "detached"
    assert not repo.get(first.id).profile
    state = repo.snapshot()
    state["bindings"]["station"][first.id]["identity_observed_at"] = None
    await repo.async_load(state)
    assert not repo.event_audience()
