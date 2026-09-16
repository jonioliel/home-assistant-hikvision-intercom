"""Phone display and explicit WhatsApp recipient normalization."""

import re


def mobile_display(value: str) -> str:
    """Format Israeli mobile numbers without changing other legacy numbers."""
    digits = re.sub(r"[^0-9]", "", value)
    if digits.startswith("00972"):
        digits = "0" + digits[5:]
    elif digits.startswith("972"):
        digits = "0" + digits[3:]
    if re.fullmatch(r"05[0-9]{8}", digits):
        return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"
    return value.strip()


def whatsapp_number(value: str) -> str:
    """Require an unambiguous mobile or explicit international number."""
    from .access.models import AccessError

    if not re.fullmatch(r"\+?[0-9 ()-]+", value):
        raise AccessError("whatsapp_invalid_phone")
    local = mobile_display(value).replace("-", "")
    if re.fullmatch(r"05[0-9]{8}", local):
        return "+972" + local[1:]
    compact = re.sub(r"[ ()-]", "", value)
    if compact.startswith("00"):
        compact = "+" + compact[2:]
    if re.fullmatch(r"\+[1-9][0-9]{7,14}", compact):
        return compact
    raise AccessError("whatsapp_invalid_phone")
