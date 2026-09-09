import pytest

from tools.fleet_soak import Observation, run


def test_soak_counts_recovery_and_bounds_memory():
    o = Observation()
    for error in (None, "request_failed", "request_failed", None, None):
        o.record(0.01, error)
    assert o.public()["recoveries"] == 1 and o.public()["longest_failure_streak"] == 2
    for _ in range(1200):
        o.record(0.02, None)
    assert o.public()["latency_window"] == 1000
    assert "private" not in str(o.public())


@pytest.mark.parametrize("data", ["{}", "[]", "[{}]"])
async def test_invalid_fleet_rejected_without_network(tmp_path, data):
    p = tmp_path / "fleet.json"
    p.write_text(data)
    with pytest.raises((ValueError, TypeError)):
        await run(p, 1, 3)
