"""Read-only comparison of retained desired users with a complete station inventory."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from .diagnostics import error_code
from .models import AccessError, ManagedUser, utc_now
from .normalize import canonical
from .review import compare, desired_view

if TYPE_CHECKING:
    from .manager import AccessManager


async def inspect_permissions(manager: AccessManager, station_id: str) -> dict[str, Any]:
    station = manager._station(station_id)
    driver = manager._driver(station)
    state = manager.repository.snapshot()
    stamp = manager.repository.bulk_stamp(state)
    async with asyncio.timeout(90), manager._read_slots, driver.transaction():
        await driver.client.async_confirm_identity()
        caps = await driver.async_capabilities()
        inventory = await driver.async_inventory()
    if station.driver is not driver or manager._closed or manager.repository.bulk_stamp() != stamp:
        raise AccessError("review_stale")
    api_id = next(iter(driver.client.enabled_doors))

    def compare_all() -> dict[str, Any]:
        rows = []
        owned = state["bindings"].get(station_id, {})
        users = [
            ManagedUser.from_private(raw)
            for uid, raw in state["users"].items()
            if station_id in raw["assignments"] or uid in owned
        ]
        for user in users[:1000]:
            row: dict[str, Any] = {
                "user_id": user.id,
                "display_name": user.display_name,
                "employee_no": user.employee_no,
                "revision": user.revision,
                "differences": [],
                "error": None,
            }
            try:
                observed = canonical(inventory, user.employee_no, caps)
                difference = compare(desired_view(user, station_id, api_id, caps), observed)
                row.update(difference)
                row["status"] = (
                    "unmanaged"
                    if user.id not in owned and observed["person"]
                    else "drift"
                    if difference["differences"]
                    else "matched"
                )
            except Exception as err:
                row.update(status="unverified", error=error_code(err))
            rows.append(row)
        unmanaged = sorted(set(inventory.users) - {user.employee_no for user in users})
        for employee in unmanaged[: max(0, 1000 - len(rows))]:
            rows.append(
                {
                    "user_id": None,
                    "employee_no": employee,
                    "display_name": None,
                    "revision": None,
                    "status": "unmanaged",
                    "differences": [],
                    "error": None,
                }
            )
        return {
            "station_id": station_id,
            "checked_at": utc_now(),
            "device_writes": 0,
            "complete": len(users) + len(unmanaged) <= 1000,
            "rows": rows,
            "counts": {
                key: sum(row["status"] == key for row in rows)
                for key in ("matched", "drift", "unmanaged", "unverified")
            },
            "total_candidates": len(users) + len(unmanaged),
        }

    report = await asyncio.to_thread(compare_all)
    if station.driver is not driver or manager._closed or manager.repository.bulk_stamp() != stamp:
        raise AccessError("review_stale")
    return report
