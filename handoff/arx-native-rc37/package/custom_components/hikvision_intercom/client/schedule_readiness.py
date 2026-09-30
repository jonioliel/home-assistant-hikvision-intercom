"""Operator readiness follows the verified Search route, not unsupported by-ID GETs."""

from typing import Any

from .client import HikvisionClient
from .schedule_inventory import inspect_inventory


async def inspect_readiness(client: HikvisionClient) -> dict[str, Any]:
    inventory = await inspect_inventory(client)
    return {
        "checked_at": inventory["checked_at"],
        "can_apply": False,
        "reason": "schedule_writes_unverified",
        "sample_only": False,
        "read_method": "search",
        "checks": [
            {
                "kind": item["kind"],
                "advertised": False
                if item["state"] == "unsupported"
                else True
                if item["capabilities"] is not None
                else None,
                "capabilities": item["capabilities"],
                "sample_id": None,
                "read_state": "readable"
                if (item["state"] == "complete" or item["state"] == "partial" and item["read"])
                else item["state"]
                if item["state"] in {"unsupported", "not_checked"}
                else "failed",
                "error": item["error"],
                "coverage": item["state"],
                "read": item["read"],
                "total": item["total"],
            }
            for item in inventory["checks"]
        ],
    }
