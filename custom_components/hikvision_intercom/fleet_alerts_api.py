"""Authenticated fleet triage. Suppression changes presentation, not device state."""

from typing import Any

from homeassistant.core import HomeAssistant

from .access.models import AccessError
from .access_runtime import get_manager
from .const import DOMAIN
from .fleet_alerts import FleetAlerts
from .operator_scope import contains_station


async def dispatch_alerts(
    hass: HomeAssistant,
    command: str,
    msg: dict[str, Any],
    actor: str,
    *,
    policy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    alerts = hass.data[DOMAIN].get("fleet_alerts")
    if not isinstance(alerts, FleetAlerts):
        raise AccessError("fleet_alerts_unavailable")
    if command == "fleet/alerts_action":
        if policy is not None and not contains_station(policy, msg["station_id"]):
            raise AccessError("unauthorized")
        get_manager(hass)._station(msg["station_id"])
        return await alerts.action(
            msg["revision"],
            msg["station_id"],
            msg["kind"],
            msg["action"],
            msg["duration_minutes"],
            msg["reason"],
            actor,
        )
    # Reuse current cached observations without adding a network/device read.
    from .websocket import overview

    stations = overview(hass)["stations"]
    if policy is not None:
        # Filter evidence before deriving counters, paging and maintenance lists.
        stations = [station for station in stations if contains_station(policy, station["id"])]
    history = hass.data[DOMAIN].get("fleet_health")
    samples = (
        {station["id"]: history.public(station["id"])["records"] for station in stations}
        if history is not None
        else {}
    )
    return alerts.report(
        stations,
        samples,
        offset=msg["offset"],
        limit=msg["limit"],
        station_id=msg["station_id"],
        kind=msg["kind"],
        include_suppressed=msg["include_suppressed"],
    )
