"""Measure read-only fleet reachability; never opens a door or changes station state.

Run with --config private/fleet.json --seconds 300 --output private/soak.json.
Configuration is a JSON list of ConnectionSettings mappings, limited to nine stations.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from custom_components.hikvision_intercom.client.client import (
    ConnectionSettings,
    HikvisionClient,
    create_session,
)
from custom_components.hikvision_intercom.exceptions import HikvisionAuthError, HikvisionError


@dataclass
class Observation:
    attempts: int = 0
    successes: int = 0
    recoveries: int = 0
    failures: int = 0
    longest_failures: int = 0
    last_failure: str | None = None
    latencies: deque[float] = field(default_factory=lambda: deque(maxlen=1000))

    def record(self, elapsed: float, error: str | None) -> None:
        self.attempts += 1
        if error:
            self.failures += 1
            self.longest_failures = max(self.longest_failures, self.failures)
            self.last_failure = (
                error if error in {"authentication", "request_failed"} else "request_failed"
            )
        else:
            self.recoveries += int(self.failures > 0)
            self.failures = 0
            self.successes += 1
            self.latencies.append(round(elapsed * 1000, 1))

    def public(self) -> dict[str, Any]:
        values = sorted(self.latencies)
        return {
            "attempts": self.attempts,
            "successful_reads": self.successes,
            "failed_reads": self.attempts - self.successes,
            "recoveries": self.recoveries,
            "longest_failure_streak": self.longest_failures,
            "last_failure": self.last_failure,
            "latency_window": len(values),
            "p95_ms": values[min(len(values) - 1, int(len(values) * 0.95))] if values else None,
        }


async def measure(settings: ConnectionSettings, seconds: int, interval: int) -> dict[str, Any]:
    observation = Observation()
    deadline = time.monotonic() + seconds
    async with create_session(settings) as session:
        client = HikvisionClient(session, settings)
        while time.monotonic() < deadline:
            started = time.monotonic()
            error = None
            try:
                async with asyncio.timeout(min(10, max(0.1, deadline - started))):
                    await client.async_call_status()
            except HikvisionAuthError:
                error = "authentication"
            except (HikvisionError, TimeoutError):
                error = "request_failed"
            observation.record(time.monotonic() - started, error)
            if error == "authentication":
                break  # Avoid repeated failed credentials against a station.
            wait = min(interval, deadline - time.monotonic())
            if wait > 0:
                await asyncio.sleep(wait)
    return observation.public()


async def run(config: Path, seconds: int, interval: int) -> dict[str, Any]:
    data = json.loads(await asyncio.to_thread(config.read_text, encoding="utf-8-sig"))
    if (
        not isinstance(data, list)
        or not 1 <= len(data) <= 9
        or not 1 <= seconds <= 86400
        or not 3 <= interval <= 60
    ):
        raise ValueError("Invalid fleet or measurement bounds")
    try:
        settings = [ConnectionSettings.from_mapping(item) for item in data]
    except (KeyError, AttributeError, TypeError):
        raise ValueError("Invalid fleet settings") from None
    started = datetime.now(UTC).isoformat()
    results = await asyncio.gather(*(measure(item, seconds, interval) for item in settings))
    return {
        "format": "hikvision_intercom.fleet_soak",
        "started_at": started,
        "finished_at": datetime.now(UTC).isoformat(),
        "read_only": True,
        "scope": "call_status_reachability_not_physical_or_sync_acceptance",
        "stations": [{"slot": i + 1, **row} for i, row in enumerate(results)],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--seconds", type=int, default=300)
    parser.add_argument("--interval", type=int, default=5)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    logging.disable(logging.CRITICAL)
    try:
        report = asyncio.run(run(args.config, args.seconds, args.interval))
        # Do not overwrite credentials, previous observations or other files.
        with args.output.open("x", encoding="utf-8") as target:
            json.dump(report, target, indent=2)
    except (OSError, ValueError, TypeError, HikvisionError):
        parser.exit(1, "Measurement failed; credentials and raw responses omitted.\n")
    print("Read-only fleet report saved.")


if __name__ == "__main__":
    main()
