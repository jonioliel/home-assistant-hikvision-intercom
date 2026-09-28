import asyncio
import json
from unittest.mock import patch

import pytest

from custom_components.hikvision_intercom.exceptions import HikvisionAuthError
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


def config(tmp_path, count=12):
    path = tmp_path / "fleet.json"
    path.write_text(
        json.dumps(
            [
                {
                    "host": f"192.0.2.{i + 1}",
                    "username": "private-user",
                    "password": "private-password",
                }
                for i in range(count)
            ]
        )
    )
    return path


class Session:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass


async def test_more_than_nine_is_supported_with_bounded_reads_and_isolated_failure(tmp_path):
    active = peak = 0
    seen = []

    class Client:
        def __init__(self, session, settings):
            self.settings = settings

        async def async_call_status(self):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            seen.append(self.settings.host)
            try:
                await asyncio.sleep(0.01)
                if self.settings.host == "192.0.2.1":
                    raise HikvisionAuthError("private-password")
                if self.settings.host == "192.0.2.2":
                    raise RuntimeError("private response")
            finally:
                active -= 1

    with (
        patch("tools.fleet_soak.create_session", return_value=Session()),
        patch("tools.fleet_soak.HikvisionClient", Client),
    ):
        report = await run(config(tmp_path), 1, 3, concurrency=3)
    assert len(report["stations"]) == 12 and len(seen) == 12
    assert peak == 3 and active == 0
    assert report["stations"][0]["last_failure"] == "authentication"
    assert report["stations"][1]["error"] == "measurement_failed"
    assert all(row["successful_reads"] == 1 for row in report["stations"][2:])
    assert not report["all_stations_sampled"]
    assert "private" not in json.dumps(report) and "192.0.2" not in json.dumps(report)


@pytest.mark.parametrize(
    "bounds",
    [{"concurrency": 0}, {"concurrency": 65}, {"station_budget": 1}, {"station_budget": True}],
)
async def test_explicit_budgets_reject_before_network(tmp_path, bounds):
    with patch("tools.fleet_soak.create_session") as create:
        with pytest.raises(ValueError):
            await run(config(tmp_path), 1, 3, **bounds)
        create.assert_not_called()


async def test_duplicate_station_endpoint_is_not_polled_twice(tmp_path):
    path = config(tmp_path, 1)
    row = json.loads(path.read_text())[0]
    path.write_text(json.dumps([row, row]))
    with pytest.raises(ValueError, match="Duplicate"):
        await run(path, 1, 3)
