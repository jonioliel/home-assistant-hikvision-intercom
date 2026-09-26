"""Manufacturer call contract with advertised/state gates and no write retry."""

import json
from unittest.mock import AsyncMock

import pytest

from custom_components.hikvision_intercom.client.client import CallState
from custom_components.hikvision_intercom.client.media import (
    MediaClient,
    audio_channels,
    call_commands,
)
from custom_components.hikvision_intercom.exceptions import (
    HikvisionTimeoutError,
    HikvisionUnsupportedError,
    HikvisionValidationError,
)

CAPS = {"CallSignal": {"cmdType": {"@opt": ["answer", "reject", "hangUp"]}}}


def client():
    obj = MediaClient.__new__(MediaClient)
    obj.client = AsyncMock()
    obj.client._get.return_value = CAPS
    obj.client.async_call_status.return_value = CallState("ringing", "ring")
    obj.client._request.return_value = b'{"statusCode":1}'
    return obj


@pytest.mark.parametrize(
    ("command", "state"), [("answer", "ringing"), ("reject", "ringing"), ("hangUp", "in_call")]
)
async def test_signal_exact_contract_once(command, state):
    c = client()
    c.client.async_call_status.return_value = CallState(state, "ring")
    await c.signal(command)
    c.client.async_confirm_identity.assert_awaited_once()
    args = c.client._request.call_args
    assert args.args == ("PUT", "/ISAPI/VideoIntercom/callSignal?format=json")
    assert json.loads(args.kwargs["content"]) == {"CallSignal": {"cmdType": command}}
    assert c.client._request.await_count == 1


@pytest.mark.parametrize(
    ("command", "state"),
    [("answer", "idle"), ("hangUp", "ringing"), ("reject", "unknown"), ("request", "ringing")],
)
async def test_no_action_for_wrong_state_or_unknown_command(command, state):
    c = client()
    c.client.async_call_status.return_value = CallState(state, state)
    with pytest.raises(HikvisionValidationError):
        await c.signal(command)
    c.client._request.assert_not_called()


async def test_missing_advertisement_blocks_signal():
    c = client()
    c.client._get.return_value = {}
    with pytest.raises(HikvisionUnsupportedError):
        await c.signal("answer")
    c.client._request.assert_not_called()


async def test_uncertain_write_is_not_retried():
    c = client()
    c.client._request.side_effect = HikvisionTimeoutError("private")
    result = await c.signal("answer")
    assert result["acknowledged"] is None
    assert result["physical_result"] == "unverified"
    assert result["observation"] == "unchanged"
    assert c.client._request.await_count == 1


@pytest.mark.parametrize("response", [b"{}", b'{"statusCode":5}'])
async def test_missing_or_bad_ack_fails(response):
    c = client()
    c.client._request.return_value = response
    with pytest.raises(HikvisionValidationError):
        await c.signal("answer")


def test_media_projection_omits_unknown_strings_and_disabled_not_enabled():
    assert call_commands({"CallSignal": {"cmdType": {"@opt": ["private", "answer"]}}}) == ["answer"]
    row = audio_channels(
        {
            "TwoWayAudioChannelList": {
                "TwoWayAudioChannel": {
                    "id": "1",
                    "enabled": "false",
                    "audioCompressionType": "G.711ulaw",
                    "private": "secret",
                }
            }
        }
    )[0]
    assert row == {"id": 1, "enabled": False, "codec": "G.711ulaw"}
    assert audio_channels({}) == []


async def test_media_inspection_falls_back_to_enumerated_channel_read_only():
    c = client()
    c.client._get.side_effect = [
        CAPS,
        {
            "TwoWayAudioChannelList": {
                "TwoWayAudioChannel": {
                    "id": "1",
                    "enabled": "false",
                    "audioCompressionType": "G.711ulaw",
                }
            }
        },
        HikvisionValidationError("aggregate rejected"),
        {
            "TwoWayAudioChannel": {
                "id": "1",
                "audioCompressionType": {"@opt": "G.711ulaw,private-codec"},
            }
        },
    ]
    result = await c.inspect()
    assert result["audio_capability_source"] == "channel"
    assert result["audio_codecs"] == ["G.711ulaw"] and result["errors"] == {}
    assert c.client._get.call_args.args[0] == "/ISAPI/System/TwoWayAudio/channels/1/capabilities"
    c.client._request.assert_not_called()


async def test_media_inspection_rejects_mismatched_channel_capability():
    c = client()
    c.client._get.side_effect = [
        CAPS,
        {"TwoWayAudioChannelList": {"TwoWayAudioChannel": {"id": "1"}}},
        HikvisionValidationError("rejected"),
        {"TwoWayAudioChannel": {"id": "2"}},
    ]
    result = await c.inspect()
    assert result["errors"]["audio_capabilities"] == "media_read_failed"
    assert "audio_capability_source" not in result


@pytest.mark.parametrize(
    "command,before,after",
    [
        ("answer", "ringing", "in_call"),
        ("reject", "ringing", "idle"),
        ("hangUp", "in_call", "idle"),
        ("answer", "ringing", "idle"),
    ],
)
async def test_signal_reports_observed_state_without_claiming_answer(command, before, after):
    c = client()
    c.client.async_call_status.side_effect = [CallState(before, before), CallState(after, after)]
    result = await c.signal(command)
    assert result["observed_state"] == after
    assert result["observation"] == "state_changed"
    assert result["acknowledged"] is True and result["physical_result"] == "unverified"
    assert c.client._request.await_count == 1


async def test_acknowledged_command_survives_failed_readback():
    c = client()
    c.client.async_call_status.side_effect = [
        CallState("ringing", "ring"),
        HikvisionTimeoutError("private"),
    ]
    result = await c.signal("reject")
    assert result["acknowledged"] is True and result["observation"] == "unavailable"
    assert "private" not in json.dumps(result)
    assert c.client._request.await_count == 1


async def test_lost_ack_and_changed_state_remain_uncertain():
    c = client()
    c.client._request.side_effect = HikvisionTimeoutError("private")
    c.client.async_call_status.side_effect = [
        CallState("ringing", "ring"),
        CallState("idle", "idle"),
    ]
    result = await c.signal("reject")
    assert result["acknowledged"] is None and result["observed_state"] == "idle"
    assert result["physical_result"] == "unverified"
    assert c.client._request.await_count == 1


async def test_context_is_read_only_and_never_exposes_raw_state():
    c = client()
    c.client.async_call_status.return_value = CallState("unknown", "private_state")
    result = await c.call_context()
    assert result["state"] == "unknown"
    assert result["call_commands"] == ["answer", "reject", "hangUp"]
    assert "private_state" not in json.dumps(result)
    c.client._request.assert_not_called()
