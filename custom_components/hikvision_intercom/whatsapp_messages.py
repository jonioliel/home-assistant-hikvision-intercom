"""Bounded projection of stored Baileys messages, excluding credentials."""

import re


def project_messages(payload: dict, recipient: str) -> list[dict]:
    result = []
    for raw in payload.get("messages", [])[:200]:
        if not isinstance(raw, dict):
            continue
        key = raw.get("key") or {}
        if key.get("remoteJid") != recipient.lstrip("+") + "@s.whatsapp.net":
            continue
        message = raw.get("message") or {}
        if any(k in message for k in ("ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2")):
            continue
        text = message.get("conversation") or (message.get("extendedTextMessage") or {}).get(
            "text", ""
        )
        kind, content = "text", {}
        for name in (
            "image",
            "video",
            "audio",
            "document",
            "sticker",
            "location",
            "contact",
            "pollCreation",
        ):
            if isinstance(message.get(name + "Message"), dict):
                kind, content = name, message[name + "Message"]
                break
        caption = content.get("caption") or content.get("displayName") or content.get("name") or ""
        if kind == "location":
            caption = (
                f"{content.get('name', '')} {content.get('degreesLatitude', '')}, "
                f"{content.get('degreesLongitude', '')}"
            )
        if kind == "pollCreation":
            caption = (
                str(caption)
                + "\n"
                + "\n".join(
                    str(option.get("optionName", ""))[:200]
                    for option in content.get("options", [])[:20]
                    if isinstance(option, dict)
                )
            )
        if kind == "contact":
            numbers = re.findall(r"(?:^|\n)TEL[^:]*:([^\r\n]+)", str(content.get("vcard", "")))
            caption = str(caption) + "\n" + ", ".join(numbers[:10])
        context = (
            content.get("contextInfo")
            or (message.get("extendedTextMessage") or {}).get("contextInfo")
            or {}
        )
        quoted = context.get("quotedMessage") or {}
        quote = quoted.get("conversation") or (quoted.get("extendedTextMessage") or {}).get(
            "text", ""
        )
        stamp = raw.get("messageTimestamp", 0)
        if isinstance(stamp, dict):
            stamp = stamp.get("low", 0)
        try:
            stamp = max(0, min(int(stamp), 253402300799))
        except (TypeError, ValueError):
            stamp = 0
        media = raw.get("_mediaUrl")
        if not isinstance(media, str) or not re.fullmatch(
            r"/media/[A-Za-z0-9_/-]+\.[A-Za-z0-9]{1,8}", media
        ):
            media = None
        result.append(
            {
                "id": str(key.get("id", ""))[:200],
                "outgoing": key.get("fromMe") is True,
                "timestamp": stamp,
                "text": str(text)[:12000],
                "caption": str(caption)[:2000],
                "kind": kind,
                "quote": str(quote)[:2000],
                "filename": str(content.get("fileName", ""))[:200],
                "media_path": media,
            }
        )
    return sorted(result, key=lambda item: item["timestamp"])
