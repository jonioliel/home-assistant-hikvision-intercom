"""Read the documented station clock without changing NTP, clock or DST settings."""

import asyncio
from datetime import UTC, datetime
from time import monotonic
from typing import Any

from ..clock_health import measured_clock
from .client import HikvisionClient


class ClockClient:
    def __init__(self, client: HikvisionClient) -> None:
        self.client = client

    async def async_read(self) -> dict[str, Any]:
        # Separate optional reads from the fast call-state/relay I/O lane.
        reader = HikvisionClient(
            self.client._session,
            self.client.settings,
            expected_identity=self.client._expected_identity,
        )
        await reader.async_confirm_identity()
        started, tick = datetime.now(UTC), monotonic()
        payload = await reader._get("/ISAPI/System/time")
        received, elapsed = datetime.now(UTC), monotonic() - tick
        return await asyncio.to_thread(measured_clock, payload, started, received, elapsed)
