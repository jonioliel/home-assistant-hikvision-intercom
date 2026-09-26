"""UI flow only enables release after a deliberate test and physical confirmation."""

from dataclasses import replace
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResultType
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.hikvision_intercom.const import DOMAIN
from custom_components.hikvision_intercom.exceptions import HikvisionAuthError

from .conftest import DATA, PROFILE


@pytest.fixture(autouse=True)
def no_setup():
    with patch(
        "custom_components.hikvision_intercom.async_setup_entry", AsyncMock(return_value=True)
    ):
        yield


async def start(hass):
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert result["step_id"] == "user"
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {k: v for k, v in DATA.items() if k != "locks"}
    )
    assert result["step_id"] == "confirm_device"
    return await hass.config_entries.flow.async_configure(result["flow_id"], {})


async def test_camera_only_flow_never_unlocks(hass, device_io):
    result = await start(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"mode": "camera_only"}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"]["locks"] == []
    device_io["unlock"].assert_not_called()
    await hass.async_block_till_done()


async def test_mapping_requires_test_and_physical_result(hass, device_io):
    result = await start(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"mode": "map_active_relay"}
    )
    device_io["unlock"].assert_not_called()
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"api_id": 1, "test_unlock": False}
    )
    assert result["errors"] == {"base": "test_required"}
    device_io["unlock"].assert_not_called()
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"api_id": 1, "test_unlock": True}
    )
    assert result["step_id"] == "confirm_mapping"
    device_io["unlock"].assert_awaited_once_with(1)
    assert not hass.config_entries.async_entries(DOMAIN)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"result": "released_and_returned"}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"]["locks"] == DATA["locks"]
    await hass.async_block_till_done()


async def test_duplicate_device(hass, device_io):
    entry = MockConfigEntry(domain=DOMAIN, unique_id=PROFILE.unique_id, data=DATA)
    entry.add_to_hass(hass)
    result = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": config_entries.SOURCE_USER},
        data={k: v for k, v in DATA.items() if k != "locks"},
    )
    assert result["reason"] == "already_configured"
    device_io["unlock"].assert_not_called()


async def test_auth_failure_form_has_no_saved_password_default(hass, device_io):
    device_io["profile"].side_effect = HikvisionAuthError("private detail")
    result = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": config_entries.SOURCE_USER},
        data={k: v for k, v in DATA.items() if k != "locks"},
    )
    assert result["errors"] == {"base": "invalid_auth"}
    assert "demo-secret" not in str(result["data_schema"])


@pytest.mark.parametrize(
    "source", [config_entries.SOURCE_RECONFIGURE, config_entries.SOURCE_REAUTH]
)
async def test_reconfigure_and_reauth_reject_wrong_identity(hass, device_io, source):
    entry = MockConfigEntry(domain=DOMAIN, title="Front", unique_id=PROFILE.unique_id, data=DATA)
    entry.add_to_hass(hass)
    device_io["profile"].return_value = replace(PROFILE, unique_id="DIFFERENT")
    result = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": source, "entry_id": entry.entry_id},
        data=DATA if source == config_entries.SOURCE_REAUTH else None,
    )
    data = (
        {"username": "demo", "password": "new-secret"}
        if source == config_entries.SOURCE_REAUTH
        else {k: v for k, v in DATA.items() if k != "locks"}
    )
    result = await hass.config_entries.flow.async_configure(result["flow_id"], data)
    assert result["reason"] == "unique_id_mismatch"
    assert entry.data["password"] == "demo-secret"


async def test_reconfigure_keeps_mapping_without_release(hass, device_io):
    entry = MockConfigEntry(domain=DOMAIN, title="Front", unique_id=PROFILE.unique_id, data=DATA)
    entry.add_to_hass(hass)
    with patch.object(hass.config_entries, "async_reload", AsyncMock(return_value=True)):
        result = await hass.config_entries.flow.async_init(
            DOMAIN,
            context={"source": config_entries.SOURCE_RECONFIGURE, "entry_id": entry.entry_id},
        )
        data = {k: v for k, v in DATA.items() if k not in {"locks", "password"}}
        result = await hass.config_entries.flow.async_configure(result["flow_id"], data)
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {"mode": "keep_confirmed_mapping"}
        )
        assert result["reason"] == "reconfigure_successful"
        await hass.async_block_till_done()
    assert entry.data["locks"] == DATA["locks"]
    assert entry.data["password"] == DATA["password"]
    device_io["unlock"].assert_not_called()


async def test_options(hass):
    entry = MockConfigEntry(domain=DOMAIN, title="Front", unique_id=PROFILE.unique_id, data=DATA)
    entry.add_to_hass(hass)
    result = await hass.config_entries.options.async_init(entry.entry_id)
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"idle_interval": 2.0, "active_interval": 0.75, "pulse_seconds": 4.0}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert entry.options["pulse_seconds"] == 4.0


async def test_failed_mapping_does_not_create_entry(hass, device_io):
    from custom_components.hikvision_intercom.exceptions import HikvisionTimeoutError

    result = await start(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"mode": "map_active_relay"}
    )
    device_io["unlock"].side_effect = HikvisionTimeoutError("timeout")
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"api_id": 1, "test_unlock": True}
    )
    assert result["errors"] == {"base": "unlock_failed"}
    assert not hass.config_entries.async_entries(DOMAIN)
    device_io["unlock"].assert_awaited_once()


async def test_successful_reauth_preserves_mapping(hass, device_io):
    entry = MockConfigEntry(domain=DOMAIN, title="Front", unique_id=PROFILE.unique_id, data=DATA)
    entry.add_to_hass(hass)
    with patch.object(hass.config_entries, "async_reload", AsyncMock(return_value=True)):
        result = await hass.config_entries.flow.async_init(
            DOMAIN,
            context={"source": config_entries.SOURCE_REAUTH, "entry_id": entry.entry_id},
            data=DATA,
        )
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {"username": "demo", "password": "replacement-secret"}
        )
        assert result["reason"] == "reauth_successful"
        await hass.async_block_till_done()
    assert entry.data["password"] == "replacement-secret"
    assert entry.data["locks"] == DATA["locks"]
    device_io["unlock"].assert_not_called()


@pytest.mark.parametrize(
    ("error_name", "key"),
    [
        ("HikvisionUnsupportedError", "unsupported_device"),
        ("HikvisionValidationError", "invalid_response"),
        ("HikvisionConnectionError", "cannot_connect"),
    ],
)
async def test_connection_error_categories(hass, device_io, error_name, key):
    from custom_components.hikvision_intercom import exceptions

    device_io["profile"].side_effect = getattr(exceptions, error_name)("private detail")
    result = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": config_entries.SOURCE_USER},
        data={k: v for k, v in DATA.items() if k != "locks"},
    )
    assert result["errors"] == {"base": key}


async def test_identity_change_between_discovery_and_unlock(hass, device_io):
    result = await start(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"mode": "map_active_relay"}
    )
    with patch(
        "custom_components.hikvision_intercom.client.client.HikvisionClient.async_device_info",
        AsyncMock(return_value=("different", PROFILE.model, PROFILE.firmware, "different")),
    ):
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {"api_id": 1, "test_unlock": True}
        )
    assert result["errors"] == {"base": "unlock_failed"}
    device_io["unlock"].assert_not_called()


async def test_remapping_and_camera_only_after_test(hass, device_io):
    result = await start(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"mode": "map_active_relay"}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"api_id": 1, "test_unlock": True}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"result": "choose_again"}
    )
    assert result["step_id"] == "mapping"
    device_io["unlock"].assert_awaited_once()
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"api_id": 2, "test_unlock": True}
    )
    device_io["unlock"].assert_awaited_with(2)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"result": "camera_only"}
    )
    assert result["data"]["locks"] == []
    await hass.async_block_till_done()


async def test_boolean_api_id_cannot_bypass_mapping_guard(hass, device_io):
    result = await start(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"mode": "map_active_relay"}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"api_id": True, "test_unlock": True}
    )
    assert result["errors"] == {"base": "invalid_mapping"}
    device_io["unlock"].assert_not_called()


async def test_lost_mapping_ack_cannot_enable_lock(hass, device_io):
    from custom_components.hikvision_intercom.config_flow import HikvisionConfigFlow

    flow = HikvisionConfigFlow()
    flow.hass = hass
    result = await flow.async_step_confirm_mapping({"result": "released_and_returned"})
    assert result["errors"] == {"base": "confirmation_required"}
    device_io["unlock"].assert_not_called()


async def test_reconfigure_replaces_invalid_saved_mapping(hass, device_io):
    entry = MockConfigEntry(
        domain=DOMAIN, unique_id=PROFILE.unique_id, data={**DATA, "locks": [{"confirmed": False}]}
    )
    entry.add_to_hass(hass)
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_RECONFIGURE, "entry_id": entry.entry_id}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {k: v for k, v in DATA.items() if k != "locks"}
    )
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["step_id"] == "locks"
    assert "keep_confirmed_mapping" not in str(result["data_schema"])


async def test_reauth_failure_keeps_original(hass, device_io):
    entry = MockConfigEntry(domain=DOMAIN, unique_id=PROFILE.unique_id, data=DATA)
    entry.add_to_hass(hass)
    result = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": config_entries.SOURCE_REAUTH, "entry_id": entry.entry_id},
        data=DATA,
    )
    device_io["profile"].side_effect = HikvisionAuthError("bad credentials")
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"username": "demo", "password": "bad-secret"}
    )
    assert result["errors"] == {"base": "invalid_auth"}
    assert entry.data["password"] == DATA["password"]


async def test_nonfinite_options_not_saved(hass):
    entry = MockConfigEntry(domain=DOMAIN, unique_id=PROFILE.unique_id, data=DATA)
    entry.add_to_hass(hass)
    result = await hass.config_entries.options.async_init(entry.entry_id)
    from homeassistant.data_entry_flow import InvalidData

    with pytest.raises(InvalidData):
        result = await hass.config_entries.options.async_configure(
            result["flow_id"],
            {"idle_interval": float("nan"), "active_interval": 0.75, "pulse_seconds": 5.0},
        )
    assert entry.options == {}


@pytest.mark.parametrize("verify_ssl", [True, False])
async def test_https_settings_preserved(hass, device_io, verify_ssl):
    data = {k: v for k, v in DATA.items() if k != "locks"}
    data.update(scheme="https", port=443, verify_ssl=verify_ssl)
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}, data=data
    )
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"mode": "camera_only"}
    )
    assert result["data"]["verify_ssl"] is verify_ssl
    assert result["data"]["scheme"] == "https" and result["data"]["port"] == 443
    await hass.async_block_till_done()


@pytest.mark.parametrize("name", ["Main door", ""])
async def test_reconfigure_can_rename_or_clear_lock_without_release(hass, device_io, name):
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Front",
        unique_id=PROFILE.unique_id,
        data={**DATA, "locks": [{**DATA["locks"][0], "name": "Previous door"}]},
    )
    entry.add_to_hass(hass)
    with patch.object(hass.config_entries, "async_reload", AsyncMock(return_value=True)):
        result = await hass.config_entries.flow.async_init(
            DOMAIN,
            context={"source": config_entries.SOURCE_RECONFIGURE, "entry_id": entry.entry_id},
        )
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {k: v for k, v in DATA.items() if k not in {"locks", "password"}}
        )
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {"mode": "keep_confirmed_mapping", "lock_name": name}
        )
        assert result["reason"] == "reconfigure_successful"
        await hass.async_block_till_done()
    expected = {**DATA["locks"][0], **({"name": name} if name else {})}
    assert entry.data["locks"] == [expected]
    device_io["unlock"].assert_not_called()


async def test_new_named_lock_still_requires_physical_confirmation(hass, device_io):
    result = await start(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"mode": "map_active_relay", "lock_name": "  Entry door  "}
    )
    device_io["unlock"].assert_not_called()
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"api_id": 1, "test_unlock": True}
    )
    assert not hass.config_entries.async_entries(DOMAIN)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"result": "released_and_returned"}
    )
    assert result["data"]["locks"] == [{**DATA["locks"][0], "name": "Entry door"}]
    device_io["unlock"].assert_awaited_once_with(1)
    await hass.async_block_till_done()
