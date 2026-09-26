"""Recipient isolation and bounded chat projections."""

import pytest

from custom_components.smplwise_access_control.access.models import AccessError
from custom_components.smplwise_access_control.phone import mobile_display, whatsapp_number
from custom_components.smplwise_access_control.whatsapp_messages import project_messages


@pytest.mark.parametrize("raw", ["0511231234", "051-123-1234", "+972511231234", "00972511231234"])
def test_israeli_number_has_one_display_and_recipient(raw):
    assert mobile_display(raw) == "051-123-1234"
    assert whatsapp_number(raw) == "+972511231234"


@pytest.mark.parametrize(
    "raw", ["", "511231234", "1234567", "0511231234@evil", "javascript:0511231234"]
)
def test_ambiguous_recipient_is_rejected(raw):
    with pytest.raises(AccessError):
        whatsapp_number(raw)


def test_history_exact_recipient_no_secrets_or_external_media():
    def message(jid, **extra):
        return {
            "key": {"remoteJid": jid, "id": "m1", "fromMe": True},
            "message": {"imageMessage": {"caption": "A photo", "mediaKey": "SECRET"}},
            "messageTimestamp": {"low": 123},
            **extra,
        }

    target = "972511231234@s.whatsapp.net"
    payload = {
        "messages": [
            message(target, _mediaUrl="/media/photo.jpg"),
            message("1972511231234@s.whatsapp.net"),
            message(target, _mediaUrl="https://example.com/secret"),
            message(target, _mediaUrl="/media/../secret.jpg"),
            message(target, message={"viewOnceMessage": {"message": {}}}),
        ]
    }
    result = project_messages(payload, "+972511231234")
    assert len(result) == 3
    assert result[0]["media_path"] == "/media/photo.jpg"
    assert result[1]["media_path"] is None and result[2]["media_path"] is None
    assert "SECRET" not in str(result)
    assert all(m["timestamp"] == 123 for m in result)
