from unittest.mock import patch

from custom_components.hikvision_intercom.access.diagnostics import SyncDiagnostics
from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.event_diagnostics import EventTelemetry
from custom_components.hikvision_intercom.hardening import RequestMetrics


def test_quality_reference_has_disjoint_windows_and_does_not_invent_success_without_samples():
    metrics = RequestMetrics()
    assert metrics.quality()["failure_percent"] is None
    assert metrics.quality()["p95_delta_ms"] is None
    for _ in range(20):
        metrics.record(0.1, False)
    assert metrics.quality()["baseline_p95_ms"] == 100
    assert metrics.quality()["comparison_samples"] == 0
    for _ in range(20):
        metrics.record(0.2, True)
    report = metrics.quality()
    assert report["failure_percent"] == 50
    assert report["p95_delta_ms"] == 100
    assert report["basis"] == "since_runtime_start"
    for _ in range(300):
        metrics.record(0.3, False)
    assert metrics.quality()["comparison_samples"] == metrics.quality()["sample_count"] == 100
    assert metrics.quality()["baseline_p95_ms"] == 100
    assert metrics.quality()["window_failure_percent"] == 0
    metrics.record(float("nan"), False)
    metrics.record(float("inf"), False)
    assert metrics.requests == 340


def test_sync_quality_covers_whole_attempt_and_repetition_without_person_data():
    diagnostics = SyncDiagnostics(lambda data: "a" * 64 if "station" in str(data) else "b" * 64)
    clock = [1.0]
    with patch(
        "custom_components.hikvision_intercom.access.diagnostics.monotonic",
        side_effect=lambda: clock[0],
    ):
        diagnostics.stage("station-secret", "person-secret", "identity")
        diagnostics.stage("station-secret", "person-secret", "readback")
        clock[0] = 3.0
        diagnostics.finish("station-secret", "person-secret", error=AccessError("device_busy"))
        clock[0] = 4.0
        diagnostics.stage("station-secret", "person-secret", "identity")
        clock[0] = 8.0
        diagnostics.finish("station-secret", "person-secret")
    report = diagnostics.quality("station-secret")
    assert report["requests"] == 2 and report["failures"] == 1
    assert report["last_ms"] == 4000
    assert report["repeat_attempts_after_failure"] == 1
    assert "secret" not in str(report)


def test_cancelled_sync_is_not_reported_as_verified_success():
    diagnostics = SyncDiagnostics(lambda _: "a" * 64)
    diagnostics.stage("station", "person", "identity")
    diagnostics.finish("station", "person", outcome="cancelled")
    assert diagnostics.quality("station")["requests"] == 0


def test_gaps_measure_transport_only_and_initial_connect_is_not_a_gap():
    telemetry = EventTelemetry()
    telemetry.transport_disconnected()
    assert telemetry.public()["transport_gaps"]["count"] == 0
    with patch(
        "custom_components.hikvision_intercom.event_diagnostics.monotonic", side_effect=[10, 15, 20]
    ):
        telemetry.transport_connected()
        telemetry.transport_disconnected()
        telemetry.transport_disconnected()
        assert telemetry.public()["transport_gaps"]["disconnected_seconds"] == 5
        telemetry.transport_connected()
    report = telemetry.public()["transport_gaps"]
    assert report["disconnected_seconds"] == 10 and report["count"] == 1
    assert not report["open"] and report["lost_event_count"] is None
