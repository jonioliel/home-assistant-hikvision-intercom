"""Authenticated repository backups and actor-bound, collision-aware import reviews."""

from __future__ import annotations

import asyncio
import base64
import json
import secrets
import time
from copy import deepcopy
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

from .csv_transfer import validate_csv_targets
from .models import AccessError, ManagedUser, utc_now
from .repository import AccessRepository

if TYPE_CHECKING:
    from .manager import AccessManager

MAX_BYTES = 33_554_432
HEADER = b"smplwise-access-backup:v1:aes256gcm:scrypt16384-8-1"


def _password(value: Any) -> bytes:
    if not isinstance(value, str) or not 12 <= len(value) <= 512:
        raise AccessError("backup_passphrase_invalid")
    return value.encode()


def _key(password: bytes, salt: bytes) -> bytes:
    return Scrypt(salt=salt, length=32, n=16384, r=8, p=1).derive(password)


def encrypt(snapshot: dict[str, Any], passphrase: str) -> str:
    password = _password(passphrase)
    payload = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")).encode()
    if len(payload) > MAX_BYTES:
        raise AccessError("backup_too_large")
    salt, nonce = secrets.token_bytes(16), secrets.token_bytes(12)
    encrypted = AESGCM(_key(password, salt)).encrypt(nonce, payload, HEADER)
    return json.dumps(
        {
            "format": "smplwise-access",
            "version": 1,
            "data": base64.b64encode(salt + nonce + encrypted).decode(),
        }
    )


def decrypt(content: str, passphrase: str) -> dict[str, Any]:
    password = _password(passphrase)
    try:
        if not isinstance(content, str) or len(content) > MAX_BYTES * 2:
            raise ValueError
        envelope = json.loads(content)
        if (
            not isinstance(envelope, dict)
            or set(envelope) != {"format", "version", "data"}
            or envelope["format"] != "smplwise-access"
            or type(envelope["version"]) is not int
            or envelope["version"] != 1
        ):
            raise ValueError
        blob = base64.b64decode(envelope["data"], validate=True)
        if not 44 <= len(blob) <= MAX_BYTES + 44:
            raise ValueError
        payload = AESGCM(_key(password, blob[:16])).decrypt(blob[16:28], blob[28:], HEADER)
        result = json.loads(payload)
        if not isinstance(result, dict):
            raise ValueError
        return result
    except (ValueError, TypeError, KeyError, InvalidTag):
        # Do not disclose whether the password or individual ciphertext bytes were wrong.
        raise AccessError("backup_cannot_decrypt") from None


def desired(user: ManagedUser, mapping: dict[str, str]) -> dict[str, Any]:
    raw = user.private()
    data = {
        key: deepcopy(raw[key])
        for key in (
            "employee_no",
            "display_name",
            "phone",
            "active",
            "user_type",
            "valid_from",
            "valid_until",
            "pin",
            "profile",
            "group_ids",
            "photo",
            "access_timing_policy",
            "access_timing_draft",
            "access_category",
            "responsible_person",
            "access_purpose",
        )
    }
    data["cards"] = [
        {
            "card_no": card.card_no.value,
            "enabled": card.enabled,
            "label": card.label,
            "card_type": card.card_type,
        }
        for card in user.cards
    ]
    data["permission_overrides"] = {
        mapping.get(sid, sid): mode for sid, mode in user.permission_overrides.items()
    }
    data["door_permissions"] = {
        mapping.get(sid, sid): sorted(item.allowed_locks)
        for sid, item in user.assignments.items()
        if item.enabled
    }
    if len(data["permission_overrides"]) != len(user.permission_overrides) or len(
        data["door_permissions"]
    ) != sum(item.enabled for item in user.assignments.values()):
        raise AccessError("backup_mapping_collision")
    return data


class Backups:
    def __init__(self, manager: AccessManager) -> None:
        self.manager = manager
        self.reviews: dict[str, dict[str, Any]] = {}

    async def export(self, passphrase: str) -> dict[str, str]:
        content = await asyncio.to_thread(encrypt, self.manager.repository.snapshot(), passphrase)
        return {"content": content, "filename": f"smplwise-access-{utc_now()[:10]}.encrypted.json"}

    async def preview(
        self, actor: str, content: str, passphrase: str, mapping: dict[str, str], mode: str
    ) -> dict[str, Any]:
        if (
            mode not in {"add_only", "update_matching"}
            or len(mapping) > 100
            or any(
                not isinstance(k, str) or not isinstance(v, str) or not 1 <= len(v) <= 128
                for k, v in mapping.items()
            )
        ):
            raise AccessError("invalid_fields")
        snapshot = await asyncio.to_thread(decrypt, content, passphrase)
        restored = AccessRepository(_discard)
        await restored.async_load(snapshot)
        repository = self.manager.repository
        draft = repository.snapshot()
        profiles = restored.profile_settings()
        # Import definition changes explicitly; never guess the meaning of group IDs.
        if (profiles or {}).get("values") != (repository.profile_settings() or {}).get("values"):
            raise AccessError("backup_profile_settings_mismatch")
        by_employee = {user.employee_no: user for user in repository.users()}
        changes: list[dict[str, Any]] = []
        rows: list[dict[str, Any]] = []
        rules = self.manager._csv_rules()
        for user in restored.users():
            if len(rows) >= 2000:
                raise AccessError("backup_too_large")
            old = by_employee.get(user.employee_no)
            row: dict[str, Any] = {
                "name": user.display_name,
                "employee_no": user.employee_no,
                "action": "update" if old else "create",
                "error": None,
            }
            if old and mode == "add_only":
                row["action"] = "skip"
            else:
                change = {
                    "user_id": old.id if old else None,
                    "revision": old.revision if old else None,
                    "data": desired(user, mapping),
                }
                candidate = deepcopy(draft)
                try:
                    users = repository._bulk_users(candidate, [change])
                    validate_csv_targets(users[0], rules)
                except AccessError as error:
                    row["error"] = error.code
                else:
                    draft = candidate
                    changes.append(change)
            rows.append(row)
        self.reviews = {
            key: value for key, value in self.reviews.items() if value["expires"] > time.monotonic()
        }
        if len(self.reviews) >= 20:
            raise AccessError("too_many_reviews")
        identity = uuid4().hex
        errors = sum(row["error"] is not None for row in rows)
        self.reviews[identity] = {
            "actor": actor,
            "changes": changes,
            "errors": errors,
            "stamp": repository.bulk_stamp(),
            "rules": rules,
            "expires": time.monotonic() + 600,
        }
        return {
            "review_id": identity,
            "rows": rows,
            "errors": errors,
            "changed": len(changes),
            "expires_in": 600,
            "scope": "desired_people_preserving_live_ownership",
        }

    async def apply(self, actor: str, identity: str, confirmed: bool) -> dict[str, Any]:
        repository = self.manager.repository
        receipt_id = "backup-" + identity
        existing = repository._state["operation_receipts"].get(receipt_id)
        if existing:
            if existing["actor"] != actor:
                raise AccessError("operation_not_found")
            return {"saved": existing["changed"], "replayed": True}
        review = self.reviews.get(identity)
        if not review or review["actor"] != actor or review["expires"] < time.monotonic():
            raise AccessError("backup_review_expired")
        if confirmed is not True or review["errors"]:
            raise AccessError("confirmation_required")
        if review["rules"] != self.manager._csv_rules():
            raise AccessError("backup_review_stale")
        users = await self.manager.repository.async_bulk_apply(
            review["changes"],
            stamp=review["stamp"],
            validate=lambda user: validate_csv_targets(user, review["rules"]),
            receipt={
                "operation_id": receipt_id,
                "actor": actor,
                "action": "bulk/csv_import",
                "saved_at": utc_now(),
                "stations": sorted(self.manager.stations),
            },
        )
        self.reviews.pop(identity, None)
        for user in users:
            self.manager.request_user(user.id)
        self.manager._changed()
        return {"saved": len(users)}


async def _discard(_data: dict[str, Any]) -> None:
    """Validate/migrate the decrypted copy without writing it to the active installation."""
