"""Portable Ed25519 attestations of retained, normalized monthly event records."""

from __future__ import annotations

import base64
import json
import re
from datetime import UTC, datetime
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from .access.models import AccessError
from .events import EventCache, timestamp
from .exceptions import HikvisionValidationError
from .operations_center import canonical


def archive(rows: list[dict], month: str, key: str, now: datetime) -> dict:
    if not isinstance(month, str) or not re.fullmatch(r"20\d\d-(?:0[1-9]|1[0-2])", month):
        raise AccessError("invalid_fields")
    # Validate the same safe row contract as persistence. Retention is arrival-based;
    # archive membership is explicitly the event timestamp's UTC calendar month.
    checker = EventCache(limit=20000, days=36500)
    checker.load({"schema": 1, "records": rows}, now)
    records = [
        row
        for row in checker.rows.values()
        if timestamp(row["timestamp"]).strftime("%Y-%m") == month
    ]
    records.sort(key=lambda row: (row["timestamp"], row["id"]))
    body = {
        "format": "smplwise-event-archive",
        "version": 1,
        "month": month,
        "calendar_timezone": "UTC",
        "generated_at": now.astimezone(UTC).isoformat(),
        "scope": "retained_records_only",
        "records": records,
    }
    private = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(key))
    payload = canonical(body)
    return {
        "body": body,
        "algorithm": "Ed25519",
        "public_key": base64.b64encode(
            private.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        ).decode(),
        "signature": base64.b64encode(private.sign(payload)).decode(),
    }


def verify(content: str, trusted_public_key: str | None = None) -> dict[str, Any]:
    """A bundled public key proves consistency, not the identity of an untrusted issuer."""
    try:
        if not isinstance(content, str) or len(content.encode()) > 30_000_000:
            raise ValueError
        data = json.loads(content)
        if (
            set(data) != {"body", "algorithm", "public_key", "signature"}
            or data["algorithm"] != "Ed25519"
        ):
            raise ValueError
        body = data["body"]
        if (
            set(body)
            != {
                "format",
                "version",
                "month",
                "calendar_timezone",
                "generated_at",
                "scope",
                "records",
            }
            or body["format"] != "smplwise-event-archive"
            or type(body["version"]) is not int
            or body["version"] != 1
            or body["calendar_timezone"] != "UTC"
            or body["scope"] != "retained_records_only"
            or not isinstance(body["month"], str)
            or not re.fullmatch(r"20\d\d-(?:0[1-9]|1[0-2])", body["month"])
        ):
            raise ValueError
        if trusted_public_key is not None and data["public_key"] != trusted_public_key:
            raise ValueError
        Ed25519PublicKey.from_public_bytes(
            base64.b64decode(data["public_key"], validate=True)
        ).verify(base64.b64decode(data["signature"], validate=True), canonical(body))
        checker = EventCache(limit=20000, days=36500)
        generated = timestamp(body["generated_at"])
        if generated is None:
            raise ValueError
        checker.load({"schema": 1, "records": body["records"]}, generated)
        if any(
            timestamp(row["timestamp"]).strftime("%Y-%m") != body["month"]
            for row in checker.rows.values()
        ):
            raise ValueError
        return {
            "valid": True,
            "issuer_trusted": trusted_public_key is not None,
            "records": len(body["records"]),
            "month": body["month"],
        }
    except (ValueError, TypeError, KeyError, InvalidSignature, HikvisionValidationError):
        raise AccessError("archive_invalid") from None
