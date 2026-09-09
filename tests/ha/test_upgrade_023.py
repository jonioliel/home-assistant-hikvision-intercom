"""Boot actual HA adapters from a 0.23 private Store; mock only device HTTP."""

import asyncio
import json
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import httpx
from pytest_homeassistant_custom_component.common import MockConfigEntry
from test_access_engine import Device

from custom_components.hikvision_intercom.access_runtime import get_manager
from custom_components.hikvision_intercom.client.access import AccessClient
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.storage import AccessStore

from .conftest import DATA, PROFILE
from .test_access_runtime import finish_workers
from .test_websocket import request

# Capture production implementations before the shared device-I/O fixture stubs them.
INVENTORY = AccessClient.async_inventory
WRITE_PERSON = AccessClient.async_write_person


async def test_ha_boots_023_store_recovers_offline_queue_and_preserves_bulk_receipt(
    hass, device_io, hass_ws_client
):
    fixture = json.loads(
        (Path(__file__).parents[1] / "fixtures/upgrade_023/pending.json").read_text(
            encoding="utf-8"
        )
    )
    store = AccessStore(hass)
    await store.async_save(fixture["store"]["data"])
    before = await store.async_load()
    devices = {}
    for sid, saved in fixture["devices"].items():
        device = Device()
        device.users, device.cards = deepcopy(saved["users"]), deepcopy(saved["cards"])
        devices[sid] = device
    devices["b"].offline = True
    sessions = []

    def session_factory(settings):
        sid = "a" if settings.host == "192.0.2.10" else "b"
        session = httpx.AsyncClient(transport=httpx.MockTransport(devices[sid].handle))
        sessions.append(session)
        return session

    async def profile(client):
        return replace(
            PROFILE, unique_id=client._expected_identity, serial=client._expected_identity
        )

    async def info(client):
        return client._expected_identity, PROFILE.model, PROFILE.firmware, client._expected_identity

    entries = []
    with (
        patch("custom_components.hikvision_intercom.runtime.create_session", session_factory),
        patch.object(AccessClient, "async_inventory", INVENTORY),
        patch.object(AccessClient, "async_write_person", WRITE_PERSON),
        patch(
            "custom_components.hikvision_intercom.client.client.HikvisionClient.async_profile",
            profile,
        ),
        patch(
            "custom_components.hikvision_intercom.client.client.HikvisionClient.async_device_info",
            info,
        ),
    ):
        try:
            for index, sid in enumerate(("a", "b")):
                entry = MockConfigEntry(
                    domain=DOMAIN,
                    entry_id=sid,
                    title="Upgrade " + sid,
                    unique_id="UPGRADE-" + sid,
                    version=1,
                    minor_version=2,
                    data={**DATA, "host": f"192.0.2.{10 + index}"},
                )
                entry.add_to_hass(hass)
                entries.append(entry)
                assert await hass.config_entries.async_setup(sid)
            manager = get_manager(hass)
            await finish_workers(manager)
            resident = fixture["expected"]["resident"]
            assert manager.repository.get(resident).assignments["b"].sync_state == "offline"
            saved = await store.async_load()
            assert saved["tombstones"] and saved["retired_pins"] and saved["retired_cards"]
            assert not devices["a"].writes and not devices["b"].writes
            assert saved["operation_receipts"] == before["operation_receipts"]
            # A reload while the peer is still absent must preserve deferred work.
            assert await hass.config_entries.async_reload("b")
            await finish_workers(manager)
            devices["b"].offline = False
            manager.request("b")
            await finish_workers(manager)
            result = await store.async_load()
            assert (
                not result["tombstones"]
                and not result["retired_pins"]
                and not result["retired_cards"]
            )
            assert result["admin_audit"] == before["admin_audit"]
            assert result["operation_receipts"] == before["operation_receipts"]
            for sid, device in devices.items():
                assert device.users["1001"]["localPassword"] == "654322"
                assert "1002" not in device.users and not device.cards
                assert device.users["9999"] == fixture["devices"][sid]["users"]["9999"]
            client = await hass_ws_client(hass)
            listing = await request(client, "overview")
            assert listing["success"]
            assert "654322" not in json.dumps(listing) and "0000123456" not in json.dumps(listing)
            device_io["unlock"].assert_not_called()
        finally:
            for entry in reversed(entries):
                runtime = getattr(entry, "runtime_data", None)
                if runtime is not None and not runtime.session.is_closed:
                    await hass.config_entries.async_unload(entry.entry_id)
            await hass.async_block_till_done()
            await asyncio.gather(*(s.aclose() for s in sessions))
