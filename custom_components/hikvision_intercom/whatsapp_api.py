"""Explicit administrator-only WhatsApp actions through the installed integration."""

from __future__ import annotations

import asyncio
import base64
import secrets
from importlib import import_module

import aiohttp

from .access.models import AccessError
from .access_runtime import get_manager
from .const import DOMAIN
from .phone import whatsapp_number
from .whatsapp_messages import project_messages


def access_message(user, stations, language: str) -> str:
    he = language.startswith("he")
    lines = [f"{'שלום' if he else 'Hello'} {user.display_name},", "WisKey"]
    lines.append(("מצב המשתמש: " if he else "User status: ") + ("פעיל" if he else "Active"))
    if not user.active:
        lines[-1] = "ההרשאה אינה פעילה." if he else "Access is inactive."
    if user.pin:
        lines.append(("קוד הגישה שלך: " if he else "Your access code: ") + user.pin.value)
    else:
        lines.append("לא הוגדר קוד גישה." if he else "No access code is configured.")
    for station_id, assignment in user.assignments.items():
        if not assignment.enabled:
            continue
        station = stations.get(station_id)
        name = station.name if station else ("תחנה לא זמינה" if he else "Unavailable station")
        locks = ", ".join(str(lock) for lock in assignment.allowed_locks)
        state = (
            ("מסונכרן" if he else "Synchronized")
            if assignment.sync_state == "synced"
            else ("ממתין לאימות סנכרון" if he else "Synchronization not verified")
        )
        lines.append(f"{name} · {'דלתות' if he else 'Doors'} {locks} · {state}")
    if user.valid_from or user.valid_until:
        lines.append(
            f"{'תוקף' if he else 'Validity'}: {user.valid_from or '—'} → {user.valid_until or '—'}"
        )
    policy = user.access_timing_policy
    if policy:
        schedule = policy["schedule"]
        days = {
            "monday": "שני",
            "tuesday": "שלישי",
            "wednesday": "רביעי",
            "thursday": "חמישי",
            "friday": "שישי",
            "saturday": "שבת",
            "sunday": "ראשון",
        }
        selected = (
            schedule.get("dates")
            if schedule["mode"] == "dates"
            else [days.get(day.lower(), day) if he else day for day in schedule.get("days", [])]
        )
        periods = ", ".join(f"{p['start']}–{p['end']}" for p in schedule["periods"])
        lines.append(
            f"{'זמני כניסה' if he else 'Access times'}: {', '.join(selected or [])}; "
            f"{periods}; {schedule['timezone']}"
        )
        lines.append(
            "הזמנים כפופים להשלמת הסנכרון לתחנות."
            if he
            else "Times are subject to successful station synchronization."
        )
    elif user.access_timing_draft:
        lines.append(
            "קיימת טיוטת זמנים שאינה נאכפת. אין להסתמך עליה כהגבלת כניסה."
            if he
            else "A draft schedule exists but is not enforced."
        )
    elif not user.valid_until:
        lines.append("ללא מגבלת ימים ושעות." if he else "No weekday or time restriction.")
    lines.append("אין להעביר את הקוד לאחרים." if he else "Do not share your code.")
    return "\n".join(lines)


def _accounts(hass):
    return [
        {"id": entry.entry_id, "name": entry.title}
        for entry in hass.config_entries.async_entries("whatsapp")
        if getattr(entry.state, "value", entry.state) == "loaded"
    ]


async def dispatch_whatsapp(hass, command: str, msg: dict, actor: str):
    accounts = _accounts(hass)
    available = hass.services.has_service("whatsapp", "send_message")
    history = hass.services.has_service("whatsapp", "get_chat_messages")
    if command == "whatsapp/status":
        return {"available": available and bool(accounts), "history": history, "accounts": accounts}
    if not available or msg["account"] not in {a["id"] for a in accounts}:
        raise AccessError("whatsapp_unavailable")
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
            "message": access_message(user, manager.stations, msg["language"]),
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
