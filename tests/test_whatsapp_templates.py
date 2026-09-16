"""Pure message-template behavior, runnable without a Home Assistant installation."""

from types import SimpleNamespace

import pytest

from custom_components.hikvision_intercom.access.models import AccessError
from custom_components.hikvision_intercom.whatsapp_api import access_message
from custom_components.hikvision_intercom.whatsapp_templates import DEFAULTS, WhatsAppTemplates


def person(*, policy=None, draft=None):
    return SimpleNamespace(
        display_name="יהונתן אוליאל",
        active=True,
        pin=SimpleNamespace(value="646464"),
        assignments={
            "one": SimpleNamespace(enabled=True, allowed_locks=(1,), sync_state="synced"),
            "two": SimpleNamespace(enabled=True, allowed_locks=(1,), sync_state="synced"),
        },
        valid_from=None,
        valid_until=None,
        access_timing_policy=policy,
        access_timing_draft=draft,
    )


def stations():
    return {
        "one": SimpleNamespace(name="רקפת"),
        "two": SimpleNamespace(name="נרקיס"),
    }


def test_unrestricted_default_is_short_and_numbered():
    message = access_message(person(), stations(), "he")
    assert "שלום יהונתן אוליאל, 🥇" in message
    assert "🏫 מתנ״ס אפרת" in message
    assert "📟 646464 📟" in message
    assert "1. רקפת\n2. נרקיס" in message
    assert "ימי הכניסה" not in message and "ללא מגבלת" not in message


def test_schedule_is_included_only_when_enforced():
    draft = {"schedule": {"mode": "weekly"}}
    assert "ימי הכניסה" not in access_message(person(draft=draft), stations(), "he")
    policy = {
        "schedule": {
            "mode": "weekly",
            "days": ["monday", "tuesday", "thursday"],
            "periods": [{"start": "09:00", "end": "17:00"}],
            "timezone": "Asia/Jerusalem",
        }
    }
    message = access_message(person(policy=policy), stations(), "he")
    assert "📆 ימי הכניסה:\nשני, שלישי, חמישי" in message
    assert "⌚ שעות הכניסה:\n09:00–17:00" in message


@pytest.mark.asyncio
async def test_settings_are_durable_revisioned_and_reject_unknown_tokens():
    saved = []

    async def save(value):
        saved.append(value)

    settings = WhatsAppTemplates(save, lambda: None)
    values = {**DEFAULTS, "organization": "ארגון לדוגמה"}
    result = await settings.update(0, values)
    assert result["revision"] == 1 and saved[-1]["values"] == values
    bad = {**values, "he_unrestricted": values["he_unrestricted"] + " {{unknown}}"}
    with pytest.raises(AccessError, match="invalid_fields"):
        await settings.update(1, bad)
