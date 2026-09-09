"""Real HA transport and isolated proposal persistence; only station reads mocked."""

import json
import logging
from pathlib import Path
from unittest.mock import AsyncMock, patch

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access.schedule_compiler import compile_schedule
from custom_components.hikvision_intercom.access.schedule_plans import SchedulePlans
from custom_components.hikvision_intercom.access.schedules import DAYS
from custom_components.hikvision_intercom.access_runtime import get_manager
from custom_components.hikvision_intercom.client.schedules import ROUTES, capability
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.storage import AccessStore

from .test_schedules import draft
from .test_websocket import request

BINDINGS = {"template": 10, "weekly": 20, "holiday_group": None, "holidays": []}


def inspection():
    fixture = json.loads(
        (Path(__file__).parents[1] / "fixtures/schedule_capabilities_readonly.json").read_text()
    )
    raw = {r["root"]: r["payload"] for r in fixture["observations"] if r["item"] == "capabilities"}
    caps = {kind: capability(raw[root], root, selector) for kind, root, _, selector in ROUTES}
    caps["weekly"]["weekdays"] = list(DAYS)
    candidates = compile_schedule(draft(), BINDINGS, caps)
    return {
        "capability_fingerprint": "e" * 64,
        "capabilities": caps,
        "candidates": candidates,
        "fingerprints": {r["key"]: "a" * 64 for r in candidates},
        "report": {
            "checked_at": "2026-09-09T00:00:00+00:00",
            "can_apply": False,
            "blockers": ["schedule_writes_unverified", "schedule_ownership_unknown"],
            "resources": [
                {
                    "kind": r["kind"],
                    "id": r["id"],
                    "coverage": "complete",
                    "state": "different",
                    "fields": ["enable"],
                    "active": False,
                    "externally_referenced": False,
                }
                for r in candidates
            ],
            "users": {
                "state": "complete",
                "error": None,
                "read": 0,
                "explicit": 0,
                "implicit": 0,
                "malformed": 0,
            },
        },
    }


async def test_proposal_roundtrip_source_staleness_export_and_delete(
    hass, loaded_entry, hass_ws_client, device_io
):
    client = await hass_ws_client(hass)
    created = (await request(client, "schedules/create", data=draft()))["result"]
    with patch(
        "custom_components.hikvision_intercom.schedule_plan_api.inspect_plan",
        AsyncMock(return_value=inspection()),
    ):
        preview = await request(
            client,
            "schedules/plan_preview",
            station_id=loaded_entry.entry_id,
            schedule_id=created["id"],
            revision=1,
            bindings=BINDINGS,
        )
        assert preview["success"] and not preview["result"]["report"]["can_apply"]
        assert (await request(client, "schedules/plan_list"))["result"] == []
        saved = (await request(client, "schedules/plan_save", token=preview["result"]["token"]))[
            "result"
        ]
        checked = await request(client, "schedules/plan_recheck", plan_id=saved["id"], revision=1)
        assert checked["result"]["revision"] == 2
    await request(
        client,
        "schedules/update",
        schedule_id=created["id"],
        revision=1,
        data={**draft(), "name": "Changed"},
    )
    assert (await request(client, "schedules/plan_list"))["result"][0]["source_state"] == "changed"
    export = (await request(client, "schedules/plan_export", plan_id=saved["id"], revision=2))[
        "result"
    ]
    assert (
        "candidates" in export
        and "fingerprint" not in json.dumps(export)
        and "identity" not in json.dumps(export)
    )
    store = AccessStore(hass, key=f"{DOMAIN}.schedule_plans")
    restored = SchedulePlans(AsyncMock())
    await restored.async_load(await store.async_load())
    assert len(restored.all()) == 1
    mode = await hass.async_add_executor_job(lambda: Path(store.path).stat().st_mode & 0o777)
    assert mode == 0o600
    assert (await request(client, "schedules/plan_delete", plan_id=saved["id"], revision=2))[
        "success"
    ]
    assert (await request(client, "schedules/plan_list"))["result"] == []
    device_io["unlock"].assert_not_called()
    device_io["write_person"].assert_not_called()


async def test_stale_source_during_read_does_not_produce_approval(
    hass, loaded_entry, hass_ws_client
):
    client = await hass_ws_client(hass)
    source = (await request(client, "schedules/create", data=draft()))["result"]

    async def inspect(*args, **kwargs):
        await hass.data[DOMAIN]["schedules"].async_save(
            {**draft(), "name": "Concurrent"}, schedule_id=source["id"], revision=1
        )
        return inspection()

    with patch("custom_components.hikvision_intercom.schedule_plan_api.inspect_plan", inspect):
        result = await request(
            client,
            "schedules/plan_preview",
            station_id=loaded_entry.entry_id,
            schedule_id=source["id"],
            revision=1,
            bindings=BINDINGS,
        )
    assert result["error"]["code"] == "revision_conflict"
    assert (
        not hass.data[DOMAIN]["schedule_plans"]._pending and not hass.data[DOMAIN]["schedule_reads"]
    )


async def test_invalid_bindings_and_busy_reads_never_issue_requests_or_log_content(
    hass, loaded_entry, hass_ws_client, caplog
):
    caplog.set_level(logging.DEBUG, logger="homeassistant.components.websocket_api.http.connection")
    client = await hass_ws_client(hass)
    source = (await request(client, "schedules/create", data=draft()))["result"]
    with patch(
        "custom_components.hikvision_intercom.schedule_plan_api.inspect_plan", AsyncMock()
    ) as inspect:
        result = await request(
            client,
            "schedules/plan_preview",
            station_id=loaded_entry.entry_id,
            schedule_id=source["id"],
            revision=1,
            bindings={**BINDINGS, "template": "PRIVATE_BINDING"},
        )
        assert result["error"]["code"] == "schedule_binding_invalid"
        assert "PRIVATE_BINDING" not in caplog.text + json.dumps(result)
        hass.data[DOMAIN]["schedule_reads"] = {loaded_entry.entry_id}
        result = await request(
            client,
            "schedules/plan_preview",
            station_id=loaded_entry.entry_id,
            schedule_id=source["id"],
            revision=1,
            bindings=BINDINGS,
        )
        assert result["error"]["code"] == "schedule_read_busy"
        inspect.assert_not_called()
        hass.data[DOMAIN]["schedule_reads"] = set()


async def test_proposal_storage_corruption_preserves_core_and_drafts(hass, device_io):
    from homeassistant.helpers import issue_registry as ir
    from pytest_homeassistant_custom_component.common import MockConfigEntry

    from .conftest import DATA, PROFILE

    entry = MockConfigEntry(domain=DOMAIN, title="Front", unique_id=PROFILE.unique_id, data=DATA)
    entry.add_to_hass(hass)
    original = AccessStore.async_load

    async def load(store):
        if store.key.endswith(".schedule_plans"):
            raise AccessError("invalid_storage")
        return await original(store)

    with patch.object(AccessStore, "async_load", load):
        await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
    assert (
        hass.data[DOMAIN]["schedule_plans"] is None and hass.data[DOMAIN]["schedules"] is not None
    )
    assert get_manager(hass) is not None and ir.async_get(hass).async_get_issue(
        DOMAIN, "schedule_plans_storage_corrupt"
    )
    await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
