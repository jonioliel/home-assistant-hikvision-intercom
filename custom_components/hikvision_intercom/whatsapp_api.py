"""Explicit administrator-only WhatsApp actions through the installed integration."""

from __future__ import annotations

import asyncio
import base64
import secrets
from importlib import import_module

from .access.models import AccessError
from .const import DOMAIN
from .phone import whatsapp_number
from .whatsapp_messages import project_messages
from .whatsapp_templates import DEFAULTS, render_template


def _display_date(value: str, he: bool) -> str:
    date = str(value).split("T", 1)[0]
    if he and len(date) == 10 and date[4] == "-" and date[7] == "-":
        return f"{date[8:10]}.{date[5:7]}.{date[:4]}"
    return date


def access_message(user, stations, language: str, settings=None) -> str:
    he = language.startswith("he")
    values = settings or DEFAULTS
    door_lines: list[str] = []
    pending: list[str] = []
    for station_id, assignment in user.assignments.items():
        if not assignment.enabled:
            continue
        station = stations.get(station_id)
        name = station.name if station else ("תחנה לא זמינה" if he else "Unavailable station")
        locks = sorted(assignment.allowed_locks)
        suffix = ""
        if len(locks) > 1:
            suffix = f" ({'דלתות' if he else 'Doors'} {', '.join(str(lock) for lock in locks)})"
        door_lines.append(f"{len(door_lines) + 1}. {name}{suffix}")
        if assignment.sync_state != "synced":
            pending.append(name)

    policy = user.access_timing_policy
    schedule = policy.get("schedule", {}) if policy else {}
    day_names = {
        "monday": "שני",
        "tuesday": "שלישי",
        "wednesday": "רביעי",
        "thursday": "חמישי",
        "friday": "שישי",
        "saturday": "שבת",
        "sunday": "ראשון",
    }
    raw_days = schedule.get("days", []) if schedule.get("mode") == "weekly" else []
    days = [day_names.get(str(day).lower(), str(day)) if he else str(day) for day in raw_days]
    dates = [_display_date(value, he) for value in schedule.get("dates", [])]
    hours = ", ".join(
        f"{period['start']}–{period['end']}" for period in schedule.get("periods", [])
    )
    validity_parts: list[str] = []
    if user.valid_from:
        validity_parts.append(("מ־" if he else "From ") + _display_date(user.valid_from, he))
    if user.valid_until:
        validity_parts.append(("עד " if he else "Until ") + _display_date(user.valid_until, he))
    validity = " ".join(validity_parts)

    window: list[str] = []
    if validity:
        window.append(("📆 תוקף ההרשאה:" if he else "📆 Access validity:") + f"\n{validity}")
    if days:
        window.append(("📆 ימי הכניסה:" if he else "📆 Access days:") + f"\n{', '.join(days)}")
    elif dates:
        window.append(("📆 תאריכי הכניסה:" if he else "📆 Access dates:") + f"\n{', '.join(dates)}")
    if hours:
        window.append(("⌚ שעות הכניסה:" if he else "⌚ Access hours:") + f"\n{hours}")

    doors = "\n".join(door_lines)
    doors_section = (
        (("דלתות מורשות:" if he else "Authorized doors:") + f"\n\n{doors}\n\n")
        if doors
        else (("לא הוגדרו דלתות מורשות." if he else "No authorized doors are configured.") + "\n\n")
    )
    access_window_section = "\n\n".join(window) + ("\n\n" if window else "")
    template_key = ("he_" if he else "en_") + (
        "scheduled" if policy or user.valid_from or user.valid_until else "unrestricted"
    )
    variables = {
        "name": user.display_name,
        "organization": values["organization"],
        "pin": user.pin.value if user.pin else ("לא הוגדר" if he else "Not configured"),
        "status": ("פעיל" if he else "Active")
        if user.active
        else ("לא פעיל" if he else "Inactive"),
        "doors": doors,
        "doors_section": doors_section,
        "days": ", ".join(days),
        "dates": ", ".join(dates),
        "hours": hours,
        "validity": validity,
        "timezone": str(schedule.get("timezone", "")),
        "access_window_section": access_window_section,
    }
    message = render_template(values[template_key], variables)
    notices: list[str] = []
    if not user.active:
        notices.append("⚠️ ההרשאה אינה פעילה." if he else "⚠️ Access is inactive.")
    if user.access_timing_draft and not policy:
        notices.append(
            "⚠️ טיוטת הזמנים אינה נאכפת ואינה מגבילה כניסה."
            if he
            else "⚠️ The draft schedule is not enforced and does not restrict access."
        )
    if pending:
        notices.append(
            (
                "⚠️ ההרשאה ממתינה להשלמת סנכרון בתחנות: "
                if he
                else "⚠️ Access is awaiting synchronization at: "
            )
            + ", ".join(pending)
        )
    return "\n\n".join([*notices, message])


def _accounts(hass):
    return [
        {"id": entry.entry_id, "name": entry.title}
        for entry in hass.config_entries.async_entries("whatsapp")
        if getattr(entry.state, "value", entry.state) == "loaded"
    ]


async def dispatch_whatsapp(hass, command: str, msg: dict, actor: str):
    templates = hass.data[DOMAIN].get("whatsapp_templates")
    if command in {"whatsapp/templates_get", "whatsapp/templates_update"}:
        if templates is None:
            raise AccessError("whatsapp_templates_unavailable")
        if command == "whatsapp/templates_get":
            return templates.public(defaults=True)
        return await templates.update(msg["revision"], msg["values"])

    accounts = _accounts(hass)
    available = hass.services.has_service("whatsapp", "send_message")
    history = hass.services.has_service("whatsapp", "get_chat_messages")
    if command == "whatsapp/status":
        return {"available": available and bool(accounts), "history": history, "accounts": accounts}
    if not available or msg["account"] not in {a["id"] for a in accounts}:
        raise AccessError("whatsapp_unavailable")
    from .access_runtime import get_manager

    manager = get_manager(hass)
    user = manager.repository.get(msg["user_id"])
    number = whatsapp_number(user.phone)
    now = hass.loop.time()
    cache = hass.data[DOMAIN].setdefault("whatsapp_previews", {})
    for token in list(cache):
        if cache[token]["expires"] < now:
            del cache[token]
    bound = {
        "actor": actor,
        "user": user.id,
        "revision": user.revision,
        "phone": number,
        "account": msg["account"],
    }

    def issue(kind, **extra):
        if len(cache) >= 400:
            raise AccessError("rate_limited")
        token = secrets.token_urlsafe(32)
        cache[token] = {**bound, "kind": kind, "expires": now + 600, **extra}
        return token

    def consume(token, kind):
        item = cache.pop(token, None)
        if not item or item["kind"] != kind or any(item[k] != v for k, v in bound.items()):
            raise AccessError("whatsapp_preview_expired")
        return item

    if command == "whatsapp/preview":
        return {
            "token": issue("send"),
            "recipient": number,
            "message": access_message(
                user,
                manager.stations,
                msg["language"],
                templates.public() if templates else DEFAULTS,
            ),
        }
    if command == "whatsapp/send":
        if (
            msg["confirmed"] is not True
            or not msg["message"].strip()
            or len(msg["message"]) > 12000
        ):
            raise AccessError("invalid_fields")
        consume(msg["token"], "send")
        try:
            async with asyncio.timeout(45):
                await hass.services.async_call(
                    "whatsapp",
                    "send_message",
                    {
                        "account": msg["account"],
                        "target": number.lstrip("+"),
                        "message": msg["message"],
                    },
                    blocking=True,
                )
        except Exception:
            raise AccessError("whatsapp_send_uncertain") from None
        return {"accepted": True}
    if command == "whatsapp/history":
        if not history:
            raise AccessError("whatsapp_history_unavailable")
        try:
            async with asyncio.timeout(25):
                payload = await hass.services.async_call(
                    "whatsapp",
                    "get_chat_messages",
                    {"account": msg["account"], "target": number.lstrip("+"), "limit": 200},
                    blocking=True,
                    return_response=True,
                )
            messages = project_messages(payload, number)
        except Exception:
            raise AccessError("whatsapp_history_unavailable") from None
        # Replace previous media grants for this viewer instead of accumulating them.
        for token in list(cache):
            if cache[token]["kind"] == "media" and all(
                cache[token][k] == v for k, v in bound.items()
            ):
                del cache[token]
        for message in messages:
            path = message.pop("media_path")
            message["media_token"] = issue("media", path=path) if path else None
        return {"recipient": number, "messages": messages}
    if command == "whatsapp/media":
        import aiohttp

        item = consume(msg["token"], "media")
        try:
            provider = import_module("custom_components.whatsapp")
            client = provider.get_client_for_account(hass, msg["account"])
            headers = {"X-Auth-Token": client.api_key} if client.api_key else {}
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as session:
                async with session.get(
                    client.host.rstrip("/") + item["path"], headers=headers, allow_redirects=False
                ) as response:
                    if response.status != 200:
                        raise ValueError
                    mime = response.headers.get("Content-Type", "").split(";")[0]
                    if mime not in {
                        "image/jpeg",
                        "image/png",
                        "image/webp",
                        "image/gif",
                        "video/mp4",
                        "video/webm",
                        "audio/ogg",
                        "audio/mpeg",
                        "audio/mp4",
                        "application/pdf",
                    }:
                        raise ValueError
                    data = bytearray()
                    async for chunk in response.content.iter_chunked(65536):
                        data.extend(chunk)
                        if len(data) > 8 * 1024 * 1024:
                            raise ValueError
            return {"mime": mime, "data": base64.b64encode(data).decode("ascii")}
        except Exception:
            raise AccessError("whatsapp_media_unavailable") from None
    raise AccessError("unknown_command")
