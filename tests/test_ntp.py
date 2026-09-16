"""Clock changes preserve timezone rules and never confuse config with sync."""

import asyncio
from copy import deepcopy
from unittest.mock import AsyncMock, patch

import pytest

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.client.ntp import BASE, synchronize
from custom_components.hikvision_intercom.client.parser import parse_payload
from custom_components.hikvision_intercom.ntp_settings import DEFAULTS, NtpSettings, normalize


@pytest.mark.parametrize(
    "values",
    [
        {**DEFAULTS, "server": "http://host"},
        {**DEFAULTS, "server": "x\ny"},
        {**DEFAULTS, "server": "999.1.2.3"},
        {**DEFAULTS, "server": "-host"},
        {**DEFAULTS, "server": "a" * 65},
        {**DEFAULTS, "port": True},
        {**DEFAULTS, "interval": 0},
        {**DEFAULTS, "server": "224.1.1.1"},
    ],
)
def test_reject_invalid_settings(values):
    with pytest.raises(AccessError):
        normalize(values)


async def test_settings_persistence_revision_and_failed_write():
    save = AsyncMock()
    store = NtpSettings(save, lambda: None)
    updated = await store.update(0, {**DEFAULTS, "server": "time.google.com"})
    assert updated["revision"] == 1
    restored = NtpSettings(save, lambda: None)
    restored.load(save.call_args.args[0])
    assert restored.public() == updated
    with pytest.raises(AccessError, match="revision_conflict"):
        await store.update(0, DEFAULTS)
    save.side_effect = OSError()
    with pytest.raises(OSError):
        await store.update(1, DEFAULTS)
    assert store.public() == updated


def fake():
    obj = AsyncMock()
    obj._write_lock = asyncio.Lock()
    state = {
        "Time": {
            "timeMode": "NTP",
            "timeZone": "CST-2:00:00DST01:00:00,M4.1.0/02:00:00,M10.5.0/02:00:00",
        },
        "NTPServerList": {
            "NTPServer": {
                "id": "1",
                "addressingFormatType": "hostname",
                "hostName": "old.example",
                "portNo": "123",
                "synchronizeInterval": "60",
            }
        },
    }
    caps = {
        "id": "1",
        "addressingFormatType": {"@opt": "hostname,ipaddress"},
        "portNo": {"@min": "2", "@max": "65535"},
        "synchronizeInterval": {"@min": "1", "@max": "10080"},
    }

    async def get(path):
        if path == BASE + "/capabilities":
            return {"Time": {"timeMode": {"@opt": "manual,NTP"}}}
        if path.endswith("ntpServers/capabilities"):
            return {"NTPServerList": {"NTPServer": caps}}
        return deepcopy(
            {"Time": state["Time"]} if path == BASE else {"NTPServerList": state["NTPServerList"]}
        )

    async def request(method, path, **kw):
        data = parse_payload(kw["content"]).data
        state.update(data)
        return b"<ResponseStatus><statusCode>1</statusCode></ResponseStatus>"

    obj._get.side_effect = get
    obj._request.side_effect = request
    return obj, state, caps


@pytest.mark.parametrize("copy", [False, True])
@pytest.mark.parametrize("skew", [0.2, 45])
async def test_apply_verified_readback_and_alignment(copy, skew):
    obj, state, _ = fake()
    before = state["Time"]["timeZone"]
    clock = {"measurement": {"status": "measured", "estimated_skew_seconds": skew}}
    with patch("custom_components.hikvision_intercom.client.ntp.ClockClient") as reader:
        reader.return_value.async_read = AsyncMock(return_value=clock)
        result = await synchronize(obj, DEFAULTS, copy_system=copy)
    assert result["configuration_verified"]
    assert result["clock_verified"] == (skew < 5)
    assert state["Time"]["timeMode"] == "NTP"
    assert state["Time"]["timeZone"] == before
    assert obj._request.await_count == (3 if copy else 2)
    obj.async_confirm_identity.assert_awaited_once()


async def test_manual_ack_lost_still_restores_ntp():
    obj, state, _ = fake()
    send = obj._request.side_effect

    async def fail_manual(method, path, **kw):
        if b"<timeMode>manual</timeMode>" in kw["content"]:
            raise TimeoutError()
        return await send(method, path, **kw)

    obj._request.side_effect = fail_manual
    with pytest.raises(TimeoutError):
        await synchronize(obj, DEFAULTS, copy_system=True)
    assert b"<timeMode>NTP</timeMode>" in obj._request.call_args.kwargs["content"]
    assert not obj._write_lock.locked()


async def test_capability_limit_blocks_before_writes():
    obj, _, caps = fake()
    caps["synchronizeInterval"]["@max"] = "30"
    with pytest.raises(AccessError, match="invalid_fields"):
        await synchronize(obj, DEFAULTS, copy_system=False)
    obj._request.assert_not_called()


async def test_readback_mismatch_blocks_manual_time():
    obj, _, _ = fake()
    obj._request.side_effect = None
    obj._request.return_value = b"<ResponseStatus><statusCode>1</statusCode></ResponseStatus>"
    with pytest.raises(AccessError, match="readback_mismatch"):
        await synchronize(obj, DEFAULTS, copy_system=True)
    assert obj._request.await_count == 1


async def test_empty_success_is_not_acknowledgement():
    obj, _, _ = fake()
    obj._request.side_effect = None
    obj._request.return_value = b"{}"
    with pytest.raises(AccessError, match="ambiguous_write"):
        await synchronize(obj, DEFAULTS, copy_system=False)
