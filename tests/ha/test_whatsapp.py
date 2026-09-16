"""No external WhatsApp calls: preview, confirmation, isolation and safe failures."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.core import SupportsResponse

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.access_runtime import get_manager
from custom_components.hikvision_intercom.whatsapp_api import access_message, dispatch_whatsapp


@pytest.fixture
async def whatsapp(hass, loaded_entry):
    manager = get_manager(hass)
    user = await manager.repository.async_create(
        {"display_name": "Demo", "phone": "0511231234", "pin": "654321"}
    )
    call = AsyncMock()
    hass.services.async_register("whatsapp", "send_message", call)
    hass.services.async_register(
        "whatsapp", "get_chat_messages", call, supports_response=SupportsResponse.OPTIONAL
    )
    with (
        patch(
            "custom_components.hikvision_intercom.whatsapp_api._accounts",
            return_value=[{"id": "wa", "name": "Test"}],
        ),
    ):
        yield user, call, {"user_id": user.id, "account": "wa", "language": "he"}


async def test_preview_never_sends_and_confirmation_consumes_once(hass, whatsapp):
    user, call, args = whatsapp
    preview = await dispatch_whatsapp(hass, "whatsapp/preview", args, "admin")
    assert "654321" in preview["message"]
    assert preview["recipient"] == "+972511231234"
    call.assert_not_called()
    send = {**args, "token": preview["token"], "message": "Edited by admin", "confirmed": True}
    await dispatch_whatsapp(hass, "whatsapp/send", send, "admin")
    assert call.call_args.args[0].data == {
        "account": "wa",
        "target": "972511231234",
        "message": "Edited by admin",
    }
    with pytest.raises(AccessError, match="whatsapp_preview_expired"):
        await dispatch_whatsapp(hass, "whatsapp/send", send, "admin")
    assert call.call_count == 1


@pytest.mark.parametrize("change", ["revision", "actor", "confirmation"])
async def test_changed_or_unconfirmed_draft_cannot_send(hass, whatsapp, change):
    user, call, args = whatsapp
    preview = await dispatch_whatsapp(hass, "whatsapp/preview", args, "admin")
    if change == "revision":
        await get_manager(hass).repository.async_update(
            user.id, {"phone": "0521231234"}, expected_revision=user.revision
        )
    with pytest.raises(AccessError):
        await dispatch_whatsapp(
            hass,
            "whatsapp/send",
            {
                **args,
                "token": preview["token"],
                "message": "test",
                "confirmed": change != "confirmation",
            },
            "other" if change == "actor" else "admin",
        )
    call.assert_not_called()


async def test_upstream_send_error_is_redacted_and_never_retried(hass, whatsapp):
    _, call, args = whatsapp
    call.side_effect = RuntimeError("private text PIN 654321")
    preview = await dispatch_whatsapp(hass, "whatsapp/preview", args, "admin")
    with pytest.raises(AccessError, match="^whatsapp_send_uncertain$"):
        await dispatch_whatsapp(
            hass,
            "whatsapp/send",
            {**args, "token": preview["token"], "message": "test", "confirmed": True},
            "admin",
        )
    assert call.call_count == 1


async def test_history_uses_normalized_recipient_and_strips_raw_keys(hass, whatsapp):
    _, call, args = whatsapp
    call.return_value = {
        "messages": [
            {
                "key": {"remoteJid": "972511231234@s.whatsapp.net", "id": "id"},
                "message": {"conversation": "Hello"},
                "_mediaUrl": "/media/demo.jpg",
                "private": "SECRET",
            }
        ]
    }
    result = await dispatch_whatsapp(hass, "whatsapp/history", args, "admin")
    assert result["messages"][0]["text"] == "Hello"
    assert result["messages"][0]["media_token"]
    assert "SECRET" not in str(result) and "/media/" not in str(result)
    assert call.call_args.args[0].data["limit"] == 200


def test_message_does_not_claim_draft_enforcement():
    user = SimpleNamespace(
        display_name="Demo",
        active=True,
        pin=None,
        assignments={},
        valid_from=None,
        valid_until=None,
        access_timing_policy=None,
        access_timing_draft={"mode": "weekly"},
    )
    assert "not enforced" in access_message(user, {}, "en")
    user.access_timing_policy = {
        "schedule": {
            "mode": "weekly",
            "days": ["Monday"],
            "periods": [{"start": "12:00", "end": "18:00"}],
            "timezone": "Asia/Jerusalem",
        }
    }
    message = access_message(user, {}, "he")
    assert "שני" in message and "12:00–18:00" in message
