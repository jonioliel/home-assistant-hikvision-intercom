"""Reproduce synthetic event-cache timing; does not connect to HA or any station."""

from __future__ import annotations

import argparse
import json
import time
import tracemalloc
from datetime import UTC, datetime

from custom_components.hikvision_intercom.events import EventCache, normalize_event


def benchmark(events: int = 12000) -> dict[str, int | float]:
    if not 1 <= events <= 100000:
        raise ValueError("Use 1–100000 synthetic events")
    now = datetime.now(UTC)
    cache = EventCache(limit=5000)
    timings = []
    tracemalloc.start()
    started = time.perf_counter()
    try:
        for serial in range(events):
            row = normalize_event(
                {
                    "eventType": "AccessControllerEvent",
                    "eventState": "active",
                    "dateTime": now.isoformat(),
                    "AccessControllerEvent": {
                        "majorEventType": 5,
                        "subEventType": 181,
                        "serialNo": serial,
                    },
                },
                f"station-{serial % 4}",
                b"x" * 32,
                received=now,
                selected_api=1,
            )
            assert row is not None
            tick = time.perf_counter()
            cache.add(row, now)
            timings.append(time.perf_counter() - tick)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    return {
        "events": events,
        "stations": 4,
        "retained": len(cache.rows),
        "seconds": round(time.perf_counter() - started, 3),
        "peak_bytes": peak,
        "p95_add_ms": round(sorted(timings)[int(len(timings) * 0.95)] * 1000, 3),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--events", type=int, default=12000)
    print(json.dumps(benchmark(parser.parse_args().events)))
