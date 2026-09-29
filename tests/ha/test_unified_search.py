"""Real HA source grants, field/station privacy and late permission revocation."""

import asyncio
import json
from datetime import UTC, datetime
from unittest.mock import patch

import pytest

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.event_manager import get_events
from custom_components.hikvision_intercom.events import normalize_event
from custom_components.hikvision_intercom.panel_permissions import AREAS

from .test_operator_scopes import grant, people
from .test_websocket import request


async def search(client, **data):
    return await request(
        client, "search/query", query="Local", kind="all", offset=0, limit=25, snapshot="", **data
    )


async def test_scoped_search_cannot_infer_hidden_phone_outside_station_or_global_journal(
    hass, loaded_entry, hass_ws_client, hass_read_only_user, hass_read_only_access_token
):
    await people(hass, loaded_entry.entry_id)
    await grant(
        hass, hass_read_only_user, [loaded_entry.entry_id], phone="none", credentials="none"
    )
    events = get_events(hass)
    for sid, name in ((loaded_entry.entry_id, "Local event"), ("outside", "Secret outside")):
        row = normalize_event(
            {"major": 5, "minor": 150, "time": "2030-01-01T00:00:00Z", "name": name},
            sid,
            events.key,
            received=datetime.now(UTC),
            selected_api=None,
        )
        events.accept(row)
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    result = await search(reader)
    assert result["success"], result
    report = result["result"]
    assert report["sections"]["people"]["total"] == 1
    assert report["sections"]["events"]["total"] == 1
    assert report["sections"]["actions"]["total"] is None
    assert all(row["phone"] == "" for row in report["sections"]["people"]["records"])
    assert all(
        row["station_id"] == loaded_entry.entry_id
        for row in report["sections"]["events"]["records"]
    )
    result = await request(
        reader, "search/query", query="0501234567", kind="all", offset=0, limit=25, snapshot=""
    )
    assert result["result"]["sections"]["people"]["total"] == 0
    result = await request(
        reader, "search/query", query="x", kind="actions", offset=0, limit=25, snapshot=""
    )
    assert result["error"]["code"] == "unauthorized"


async def test_one_area_grant_never_adds_other_sources(
    hass, loaded_entry, hass_ws_client, hass_read_only_user, hass_read_only_access_token
):
    permissions = hass.data[DOMAIN]["panel_permissions"]
    await permissions.update(
        0,
        {
            hass_read_only_user.id: {
                "enabled": True,
                "areas": {area: "view" if area == "events" else "none" for area in AREAS},
            }
        },
        [hass_read_only_user.id],
    )
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    result = await search(reader)
    assert result["success"], result
    sections = result["result"]["sections"]
    assert (
        sections["events"]["available"]
        and sections["people"]["total"] is None
        and sections["actions"]["total"] is None
    )
    bad = await request(
        reader,
        "search/query",
        query="Local",
        kind="all",
        offset=0,
        limit=25,
        snapshot="",
        actor="administrator",
    )
    assert bad["error"]["code"] == "invalid_fields"


async def test_admin_search_reads_retained_action_evidence_without_credentials(
    hass, loaded_entry, hass_ws_client
):
    admin = await hass_ws_client(hass)
    person = await request(
        admin, "users/create", data={"display_name": "Local person", "pin": "918472"}
    )
    assert person["success"], person
    result = await search(admin)
    assert result["success"], result
    sections = result["result"]["sections"]
    assert sections["people"]["total"] == sections["actions"]["total"] == 1
    assert "918472" not in json.dumps(result)
    assert result["result"]["coverage"]["basis"] == "retained_records"


async def test_permission_change_while_search_runs_discards_all_results(
    hass, loaded_entry, hass_ws_client, hass_read_only_user, hass_read_only_access_token
):
    await people(hass, loaded_entry.entry_id)
    await grant(hass, hass_read_only_user, [loaded_entry.entry_id])
    reader = await hass_ws_client(hass, access_token=hass_read_only_access_token)
    entered, resume = asyncio.Event(), asyncio.Event()
    from custom_components.hikvision_intercom.search_api import search as original

    async def slow(*args):
        entered.set()
        await resume.wait()
        return await original(*args)

    with patch("custom_components.hikvision_intercom.search_api.search", side_effect=slow):
        pending = asyncio.create_task(search(reader))
        await entered.wait()
        permissions = hass.data[DOMAIN]["panel_permissions"]
        await permissions.update(permissions.revision, {}, [hass_read_only_user.id])
        resume.set()
        result = await pending
    assert result["error"]["code"] == "permissions_changed"


async def test_account_deactivation_during_executor_never_returns_search_results(
    hass, loaded_entry, hass_admin_user
):
    from custom_components.hikvision_intercom.search_api import search as adapter

    entered, resume = asyncio.Event(), asyncio.Event()
    executor = hass.async_add_executor_job

    async def delayed(job):
        if getattr(getattr(job, "func", None), "__module__", "") != (
            "custom_components.hikvision_intercom.access.unified_search"
        ):
            return await executor(job)
        entered.set()
        await resume.wait()
        return job()

    with patch.object(hass, "async_add_executor_job", side_effect=delayed):
        pending = asyncio.create_task(
            adapter(
                hass,
                {"query": "Local", "kind": "all", "offset": 0, "limit": 25, "snapshot": ""},
                hass_admin_user,
                {},
                [],
            )
        )
        await asyncio.wait_for(entered.wait(), 3)
        await hass.auth.async_update_user(hass_admin_user, is_active=False)
        resume.set()
        with pytest.raises(AccessError, match="unauthorized"):
            await pending
