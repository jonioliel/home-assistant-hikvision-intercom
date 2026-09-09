"""Audio payload redaction includes HA's serialized outgoing debug messages."""

import json
import logging

import pytest

from custom_components.hikvision_intercom.log_filter import AccessWebSocketFilter


@pytest.mark.parametrize("encoding", ["dict", "bytes", "string", "batch"])
def test_outgoing_audio_packets_and_tokens_are_redacted_without_mutating_message(encoding):
    message = {
        "id": 7,
        "type": "event",
        "event": {
            "format": "hikvision_intercom.audio",
            "token": "PRIVATE_SESSION_TOKEN",
            "data": "PRIVATE_AUDIO",
        },
    }
    original = json.dumps(message)
    value = (
        message
        if encoding == "dict"
        else [message]
        if encoding == "batch"
        else original.encode()
        if encoding == "bytes"
        else original
    )
    record = logging.LogRecord("test", logging.DEBUG, "test", 1, "Sending %s", (value,), None)
    assert AccessWebSocketFilter().filter(record)
    assert "PRIVATE_SESSION_TOKEN" not in record.getMessage()
    assert "PRIVATE_AUDIO" not in record.getMessage()
    assert json.dumps(message) == original


def test_unrelated_messages_are_not_changed():
    message = b'{"type":"result","result":{"online":true}}'
    assert AccessWebSocketFilter._redact(message) == message
