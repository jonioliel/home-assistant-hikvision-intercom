"""Allowlist export: unknown values and all identity/credential data are removed.

Never export response bytes, cookies, Digest challenges, binary images, or URLs.
Keep structural field names, known protocol values and numeric capability limits.
"""

import re
from typing import Any

REDACTED = "REDACTED"
_SENSITIVE = re.compile(
    r"password|passwd|pin(?!mode)|cardno|cardnumber|employeeno|person|username|"
    r"serial|macaddress|ipaddress|ipv[46]|address|phone|email|token|cookie|"
    r"authorization|secret|deviceid|uuid|url|uri|searchid|devicename|^name$",
    re.IGNORECASE,
)
_LIMIT_ATTRIBUTES = {"@min", "@max", "@minlength", "@maxlength", "@size", "@step"}
_CAPABILITY_LIMIT_FIELDS = {
    "maxrecordnum",
    "numberperperson",
    "maxsize",
    "maxplantemplate",
}
_NUMERIC_FIELDS = _CAPABILITY_LIMIT_FIELDS | {
    "bindcardusernumber",
    "majoreventtype",
    "subeventtype",
    "activepostcount",
    "videoresolutionwidth",
    "videoresolutionheight",
    "maxframerate",
    "constantbitrate",
    "videoinputchannelid",
    "audioinputchannelid",
    "alarmoutnum",
    "alarminnum",
    "statuscode",
    "errorcode",
    "usernumber",
    "cardnumber",
    "usernum",
    "cardnum",
    "numofmatches",
    "totalmatches",
    "searchresultposition",
    "maxresults",
    "doornum",
    "doorno",
    "doorid",
    "lockid",
    "channelid",
    "plantemplateno",
    "maxusernum",
    "maxcardnum",
    "maxcardnumperuser",
    "min",
    "max",
    "maxlength",
    "minlength",
}
_ENUM_FIELDS = {
    "responsestatusstrg",
    "videocodectype",
    "audiocompressiontype",
    "streamingtransport",
    "snapshotimagetype",
    "charactertype",
    "unlocktype",
    "callstatus",
    "status",
    "eventtype",
    "eventstate",
    "substatuscode",
    "statusstring",
    "responsesearchstatusstrg",
    "cardtype",
    "usertype",
    "pinmode",
    "pwmgrmode",
    "workstatus",
    "doorright",
    "lockstatus",
    "@opt",
    "@def",
    "@version",
    "@type",
    "@xmlns",
}
_KNOWN_NAMESPACES = {
    "http://www.isapi.org/ver20/XMLSchema",
    "http://www.hikvision.com/ver20/XMLSchema",
    "http://www.std-cgi.com/ver20/XMLSchema",
}


def safe_namespaces(namespaces: list[str]) -> list[str]:
    """Unknown namespace URLs can contain addresses or identifiers."""
    return [value if value in _KNOWN_NAMESPACES else REDACTED for value in namespaces]


def sanitize(value: Any, secrets: tuple[str, ...] = (), field: str = "", parent: str = "") -> Any:
    """Recursively retain only protocol evidence, including bounds on secret fields."""
    key = field.casefold()
    if isinstance(value, dict):
        output: dict[str, Any] = {}
        for index, (name, child) in enumerate(value.items()):
            # Avoid exposing identifiers used as keys by unexpected firmware.
            safe_key = (
                name
                if re.fullmatch(r"[@#]?[A-Za-z_][A-Za-z_0-9.-]{0,79}", name)
                else (f"redacted_field_{index}")
            )
            if any(secret and secret in safe_key for secret in secrets):
                safe_key = f"redacted_field_{index}"
            child_key = name.casefold()
            safe_flag = child_key.startswith("issupport") and str(child).casefold() in {
                "true",
                "false",
                "0",
                "1",
            }
            bounds = (
                isinstance(child, dict)
                and bool(child)
                and all(k.casefold() in _LIMIT_ATTRIBUTES for k in child)
            )
            if (
                _SENSITIVE.search(key)
                and child_key not in _LIMIT_ATTRIBUTES | _CAPABILITY_LIMIT_FIELDS
                and not safe_flag
                and not bounds
            ):
                output[safe_key] = REDACTED
            else:
                output[safe_key] = sanitize(child, secrets, name, field)
        return output
    if isinstance(value, list):
        if _SENSITIVE.search(key):
            return [REDACTED for _ in value]
        return [sanitize(child, secrets, field, parent) for child in value]
    if value is None:
        return None
    text = str(value)
    if any(secret and secret in text for secret in secrets):
        return REDACTED
    # A CardInfoCount/cardNumber is a count; every credential cardNumber stays private.
    if key == "cardnumber" and parent.casefold() == "cardinfocount":
        return (
            value
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0
            else REDACTED
        )
    if key == "numberperperson" and parent.casefold() == "cardinfo":
        return value if re.fullmatch(r"[0-9]{1,10}", text) else REDACTED
    if key.startswith("issupport") and str(value).casefold() in {"true", "false", "0", "1"}:
        return value
    if _SENSITIVE.search(key):
        return REDACTED
    if key in _LIMIT_ATTRIBUTES or key in _NUMERIC_FIELDS:
        return value if re.fullmatch(r"[0-9]{1,10}", text) else REDACTED
    if key.startswith("issupport") or key in {"enable", "enabled", "currentevent"}:
        return value if text.casefold() in {"true", "false", "0", "1"} else REDACTED
    if key == "model":
        return value if re.fullmatch(r"DS-[A-Z0-9()/_-]{1,60}", text) else REDACTED
    if key in {"firmwareversion", "firmwarereleasedate", "firmwarereleaseddate"}:
        return (
            value
            if re.fullmatch(r"(?:[Vv0-9. /_-]+(?:build [0-9]+)?|build [0-9]{6})", text)
            else REDACTED
        )
    if key == "statusstring":
        return (
            value
            if text
            in {
                "OK",
                "Invalid Operation",
                "Device Busy",
                "Invalid XML Format",
                "Invalid XML Content",
                "Reboot Required",
            }
            else REDACTED
        )
    if key in _ENUM_FIELDS:
        return value if re.fullmatch(r"[A-Za-z0-9_,. -]{1,80}", text) else REDACTED
    return REDACTED


def safe_headers(headers: Any) -> dict[str, str]:
    """Export media type and Allow only; omit multipart boundary and arbitrary text."""
    output: dict[str, str] = {}
    media = headers.get("content-type", "").split(";", 1)[0].lower().strip()
    if media in {
        "application/json",
        "application/xml",
        "text/xml",
        "text/plain",
        "text/html",
        "image/jpeg",
        "image/png",
        "multipart/mixed",
        "multipart/x-mixed-replace",
        "application/octet-stream",
    }:
        output["content-type"] = media
    allow = headers.get("allow", "")
    verbs = [verb.strip().upper() for verb in allow.split(",")]
    if all(verb in {"GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"} for verb in verbs):
        output["allow"] = ", ".join(verbs)
    return output
