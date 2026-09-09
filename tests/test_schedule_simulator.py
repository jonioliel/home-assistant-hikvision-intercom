"""Reusable synthetic commissioning evidence; no device settings or network adapter."""

import json
import subprocess
import sys

import pytest

from tools.simulate_schedule_recovery import SCENARIOS, report, simulate


@pytest.mark.parametrize("scenario", SCENARIOS)
async def test_fault_scenario_survives_serialized_restart_without_recovery_writes(scenario):
    result = await simulate(scenario)
    assert result["passed"] and result["recovery_writes"] == 0
    assert "context" not in result and "b" * 64 not in json.dumps(result)


async def test_report_explicitly_labels_synthetic_results_not_hardware_acceptance():
    result = await report()
    assert result["simulation_only"] and not result["hardware_verified"]
    assert len(result["scenarios"]) == len(SCENARIOS) and result["network_requests"] == 0


def test_cli_emits_matching_machine_readable_report_and_file(tmp_path):
    path = tmp_path / "simulation.json"
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "tools.simulate_schedule_recovery",
            "--scenario",
            "crash_applied",
            "--output",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=20,
    )
    assert json.loads(completed.stdout) == json.loads(path.read_text(encoding="utf-8"))
    assert json.loads(completed.stdout)["scenarios"][0]["recovered_status"] == "ready"
