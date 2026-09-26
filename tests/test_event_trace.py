import json
from unittest.mock import patch

import pytest
from test_events import normalized, payload

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.event_trace import EventTrace, identity_evidence


def test_trace_is_opt_in_bounded_and_contains_no_person_or_credentials():
    trace = EventTrace()
    raw = payload(
        181,
        name="PRIVATE_NAME",
        employeeNoString="PRIVATE_ID",
        cardNo="9999888877776666",
        password="PRIVATE_PIN",
    )
    row = normalized(raw)
    trace.event(raw, row)
    assert trace.public()["capture"] is None
    trace.start("idle")
    for i in range(400):
        raw = payload(
            181,
            serialNo=i,
            name="PRIVATE_NAME",
            employeeNoString="PRIVATE_ID",
            cardNo="9999888877776666",
            password="PRIVATE_PIN",
        )
        row = normalized(raw)
        trace.call("ringing" if i % 2 else "idle")
        trace.event(raw, row)
    report = trace.public()
    assert len(report["capture"]["records"]) == 300
    assert report["capture"]["dropped"] > 0
    assert len(trace.evidence) == 128
    for secret in ("PRIVATE_NAME", "PRIVATE_ID", "9999888877776666", "PRIVATE_PIN"):
        assert secret not in json.dumps(report)
        assert secret not in json.dumps(trace.evidence)
    assert report["physical_result"] == "unverified"


def test_trace_expiration_stop_revision_and_snapshot_independence():
    with patch(
        "custom_components.hikvision_intercom.event_trace.monotonic", return_value=100
    ) as clock:
        trace = EventTrace()
        report = trace.start("idle")
        with pytest.raises(AccessError, match="device_busy"):
            trace.start("idle")
        with pytest.raises(AccessError, match="revision_conflict"):
            trace.stop("old")
        report["capture"]["records"].clear()
        assert len(trace.public()["capture"]["records"]) == 1
        clock.return_value = 190
        trace.call("ringing")
        assert trace.public()["capture"]["state"] == "complete"
        assert len(trace.public()["capture"]["records"]) == 1
        other = trace.start("ringing")
        assert trace.stop(other["capture"]["capture_id"])["capture"]["state"] == "stopped"


@pytest.mark.parametrize("value", [{"private": "x"}, ["private"], None, False, 2, "PRIVATE_NAME"])
def test_unknown_event_family_cannot_leak_or_break_capture(value):
    trace = EventTrace()
    trace.start("idle")
    trace.event({"eventType": value}, None)
    report = trace.public()["capture"]["records"][-1]["observation"]
    assert report["family"] == "other"
    assert not report["live_automation"]


def test_source_field_presence_and_central_resolution_are_distinct():
    raw = payload(employeeNoString="PRIVATE", name="")
    row = normalized(raw)
    row["person_name"] = "Central name"
    trace = EventTrace()
    trace.event(raw, row, resolved=True)
    evidence = trace.evidence[row["id"]]
    assert evidence["source_fields"] == {
        "employeeNoString": "provided",
        "employeeNo": "missing",
        "name": "empty",
    }
    assert evidence["central_name_resolved"] and evidence["normalized_name"]
    assert identity_evidence({"EventNotificationAlert": []}, False, None)["normalized"] is False
