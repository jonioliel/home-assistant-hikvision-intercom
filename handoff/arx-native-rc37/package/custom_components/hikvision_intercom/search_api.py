"""Collect only sources already authorized by the existing panel policy."""

from __future__ import annotations

from functools import partial
from typing import Any

from homeassistant.core import HomeAssistant

from .access.admin_audit import query as audit_query
from .access.models import AccessError
from .access.unified_search import action_rows, event_rows, people_rows, query
from .access_runtime import get_manager
from .const import DOMAIN
from .event_manager import get_events
from .operator_scope import contains_station
from .panel_permissions import command_allowed


async def search(
    hass: HomeAssistant,
    msg: dict[str, Any],
    user: Any,
    policy: dict[str, Any],
    people: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    permissions = hass.data[DOMAIN]["panel_permissions"]
    revision = permissions.revision
    initial_policy = permissions.policy(user)
    manager = get_manager(hass)
    stations = {
        sid: station.name
        for sid, station in manager.stations.items()
        if contains_station(policy, sid)
    }
    sources: dict[str, list[dict[str, Any]] | None] = {
        "people": (
            people_rows(people)
            if people is not None and command_allowed(permissions, user, "users/query")
            else None
        ),
        "events": None,
        "actions": None,
    }
    events = None
    if command_allowed(permissions, user, "events/list"):
        events = get_events(hass).query({}, operator_policy=policy, all_records=True)
        sources["events"] = event_rows(events["records"], stations)
    if command_allowed(permissions, user, "audit/list"):
        actions = audit_query(manager.repository._state["admin_audit"], {}, exporting=True)[
            "records"
        ]
        actor_ids = {row["actor"] for row in actions}
        actors = {
            account.id: account.name or ""
            for account in await hass.auth.async_get_users()
            if account.id in actor_ids
        }
        sources["actions"] = action_rows(actions, stations, actors)
    result = await hass.async_add_executor_job(
        partial(
            query,
            sources,
            text=msg["query"],
            kind=msg["kind"],
            offset=msg["offset"],
            limit=msg["limit"],
            snapshot=msg["snapshot"],
            permission_context=str(revision),
        )
    )
    current = await hass.auth.async_get_user(user.id)
    if current is None or not current.is_active:
        raise AccessError("unauthorized")
    if permissions.revision != revision or permissions.policy(current) != initial_policy:
        raise AccessError("permissions_changed")
    result["coverage"] = {
        "basis": "retained_records",
        "event_retention_days": events["retention_days"] if events else None,
        "event_storage_failed": events["storage_failed"] if events else None,
        "action_retention_days": 30 if sources["actions"] is not None else None,
    }
    return result
