"""Read the documented station clock without changing NTP, clock or DST settings."""

import asyncio
from datetime import UTC, datetime
from typing import Any

from ..clock import parse_clock
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
        payload = await reader._get("/ISAPI/System/time")
        return await asyncio.to_thread(parse_clock, payload, datetime.now(UTC))
