"""Actionable Repairs with stable keys; transient offline states are not issues."""

from __future__ import annotations

import asyncio
from typing import Any

from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .const import DOMAIN


@callback
def issue(hass: HomeAssistant, key: str, *, active: bool, entry_id: str | None = None) -> None:
    issue_id = f"{entry_id}_{key}" if entry_id else key
    if not active:
        ir.async_delete_issue(hass, DOMAIN, issue_id)
        return
    ir.async_create_issue(
        hass,
        DOMAIN,
        issue_id,
        is_fixable=False,
        is_persistent=False,
        severity=ir.IssueSeverity.ERROR,
        translation_key=key,
        translation_placeholders={"station": hass.config_entries.async_get_entry(entry_id).title}
        if entry_id and hass.config_entries.async_get_entry(entry_id)
        else None,
        learn_more_url="https://github.com/jonioliel/home-assistant-hikvision-intercom/blob/main/docs/HARDENING.md",
    )


class RepairWatcher:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.first_conflict: dict[str, float] = {}
        self._timer: asyncio.TimerHandle | None = None
        self._closed = False
        self._unsubscribe = async_dispatcher_connect(
            hass, f"{DOMAIN}_access_changed", self.schedule
        )

    @callback
    def schedule(self) -> None:
        if self._timer is None and not self._closed:
            self._timer = self.hass.loop.call_later(1, self.refresh)

    @callback
    def refresh(self) -> None:
        if self._timer:
            self._timer.cancel()
        self._timer = None
        manager = self.hass.data.get(DOMAIN, {}).get("access")
        if manager is not None:
            public = manager.repository.public()
            for station in manager.stations.values():
                conflicts = (
                    any(
                        user["assignments"].get(station.id, {}).get("sync_state") == "conflict"
                        for user in public["users"]
                    )
                    or any(
                        item.get("stations", {}).get(station.id, {}).get("sync_state") == "conflict"
                        for item in public["tombstones"]
                    )
                    or any(
                        item["station_id"] == station.id and item["sync_state"] == "conflict"
                        for item in public["revocations"]
                    )
                )
                if conflicts:
                    self.first_conflict.setdefault(station.id, self.hass.loop.time())
                else:
                    self.first_conflict.pop(station.id, None)
                issue(
                    self.hass,
                    "sync_conflict",
                    active=conflicts
                    and self.hass.loop.time() - self.first_conflict[station.id] >= 300,
                    entry_id=station.id,
                )
                issue(
                    self.hass,
                    "access_auth",
                    active=station.error == "authentication_failed",
                    entry_id=station.id,
                )
                issue(
                    self.hass,
                    "access_capacity",
                    active=any(
                        user["assignments"].get(station.id, {}).get("last_error")
                        in {"person_capacity", "card_capacity"}
                        for user in public["users"]
                    ),
                    entry_id=station.id,
                )
        if not self._closed:
            self._timer = self.hass.loop.call_later(60, self.refresh)

    @callback
    def close(self) -> None:
        self._closed = True
        self._unsubscribe()
        if self._timer:
            self._timer.cancel()
            self._timer = None


@callback
def async_setup_repairs(hass: HomeAssistant) -> None:
    data = hass.data.setdefault(DOMAIN, {})
    if "repairs" in data:
        return
    watcher = data["repairs"] = RepairWatcher(hass)
    watcher.schedule()

    @callback
    def stop(_event: Any) -> None:
        watcher.close()

    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, stop)
