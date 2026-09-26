"""Read-only media evidence and explicitly requested, advertised call signals."""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from typing import Any

from ..exceptions import (
    HikvisionConnectionError,
    HikvisionError,
    HikvisionTimeoutError,
    HikvisionUnsupportedError,
    HikvisionValidationError,
)
from .client import HikvisionClient
from .parser import find_values, parse_payload

CALL_PATH = "/ISAPI/VideoIntercom/callSignal?format=json"
CALL_CAP = "/ISAPI/VideoIntercom/callSignal/capabilities?format=json"
COMMANDS = ("answer", "reject", "hangUp")
CODECS = {"G.711ulaw", "G.711alaw", "G.726", "AAC", "MP2L2", "PCM"}


def call_commands(payload: dict[str, Any]) -> list[str]:
    wrapper = payload.get("CallSignal")
    command = wrapper.get("cmdType") if isinstance(wrapper, dict) else None
    opts = command.get("@opt") if isinstance(command, dict) else None
    return [item for item in COMMANDS if isinstance(opts, list) and item in opts]


def audio_channels(payload: dict[str, Any]) -> list[dict[str, Any]]:
    wrapper = payload.get("TwoWayAudioChannelList")
    rows = wrapper.get("TwoWayAudioChannel", []) if isinstance(wrapper, dict) else []
    if isinstance(rows, dict):
        rows = [rows]
    if not isinstance(rows, list) or len(rows) > 16:
        return []
    result = []
    for row in rows:
        if not isinstance(row, dict) or str(row.get("id")) not in {str(i) for i in range(1, 17)}:
            continue
        enabled = str(row.get("enabled")).lower()
        result.append(
            {
                "id": int(row["id"]),
                "enabled": enabled == "true" if enabled in {"true", "false"} else None,
                "codec": row.get("audioCompressionType")
                if isinstance(row.get("audioCompressionType"), str)
                and row.get("audioCompressionType") in CODECS
                else "unknown",
            }
        )
    return result


class MediaClient:
    def __init__(self, client: HikvisionClient) -> None:
        self.client = HikvisionClient(
            client._session, client.settings, expected_identity=client._expected_identity
        )

    async def inspect(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "checked_at": datetime.now(UTC).isoformat(),
            "call_commands": [],
            "audio_channels": [],
            "errors": {},
            "audio_session_tested": False,
        }
        async with asyncio.timeout(25):
            await self.client.async_confirm_identity()
            for kind, path in (
                ("call", CALL_CAP),
                ("audio", "/ISAPI/System/TwoWayAudio/channels"),
                ("audio_capabilities", "/ISAPI/System/TwoWayAudio/channels/capabilities"),
            ):
                try:
                    data = await self.client._get(path)
                    if kind == "call":
                        result["call_commands"] = call_commands(data)
                    elif kind == "audio":
                        result["audio_channels"] = audio_channels(data)
                    else:
                        result["audio_capabilities_read"] = True
                except HikvisionError:
                    result["errors"][kind] = "media_read_failed"
                    # This firmware rejects the aggregate capability route but serves
                    # the explicitly enumerated channel's documented capability route.
                    if kind == "audio_capabilities" and result["audio_channels"]:
                        channel = result["audio_channels"][0]["id"]
                        try:
                            data = await self.client._get(
                                f"/ISAPI/System/TwoWayAudio/channels/{channel}/capabilities"
                            )
                            root = data.get("TwoWayAudioChannel")
                            if not isinstance(root, dict) or str(root.get("id")) != str(channel):
                                raise HikvisionValidationError("Mismatched audio channel")
                            compression = root.get("audioCompressionType")
                            opts = (
                                compression.get("@opt") if isinstance(compression, dict) else None
                            )
                            result["audio_capabilities_read"] = True
                            result["audio_capability_source"] = "channel"
                            result["audio_codecs"] = [
                                codec
                                for codec in sorted(CODECS)
                                if isinstance(opts, str) and codec in opts.split(",")
                            ]
                            result["errors"].pop(kind, None)
                        except HikvisionError:
                            pass
        return result

    async def call_context(self) -> dict[str, Any]:
        """Read capabilities and state without opening a call or audio session."""
        async with asyncio.timeout(15):
            await self.client.async_confirm_identity()
            commands = call_commands(await self.client._get(CALL_CAP))
            state = await self.client.async_call_status()
            return {
                "call_commands": commands,
                "state": state.normalized,
                "checked_at": datetime.now(UTC).isoformat(),
            }

    async def signal(self, command: str) -> dict[str, Any]:
        if command not in COMMANDS:
            raise HikvisionValidationError("Unsupported call command")
        async with asyncio.timeout(15):
            await self.client.async_confirm_identity()
            if command not in call_commands(await self.client._get(CALL_CAP)):
                raise HikvisionUnsupportedError("Call command is not advertised")
            state = await self.client.async_call_status()
            if state.normalized not in (
                {"ringing"} if command in {"answer", "reject"} else {"in_call"}
            ):
                raise HikvisionValidationError("No matching active call")
        acknowledged: bool | None = True
        try:
            # Exactly one attempt. A lost response never causes a write retry.
            async with asyncio.timeout(10):
                payload = parse_payload(
                    await self.client._request(
                        "PUT",
                        CALL_PATH,
                        content=json.dumps({"CallSignal": {"cmdType": command}}).encode(),
                        content_type="application/json",
                    )
                ).data
                codes = find_values(payload, "statusCode")
                if not codes or any(str(code) != "1" for code in codes):
                    raise HikvisionValidationError("Call command was not acknowledged")
        except (HikvisionConnectionError, HikvisionTimeoutError, TimeoutError):
            # Readback cannot recover a lost acknowledgement or prove causation.
            acknowledged = None
        return await self._observe(command, state.normalized, acknowledged)

    async def _observe(
        self, command: str, before: str, acknowledged: bool | None
    ) -> dict[str, Any]:
        result: dict[str, Any] = {
            "command": command,
            "acknowledged": acknowledged,
            "physical_result": "unverified",
            "before_state": before,
            "observed_state": None,
            "observation": "unavailable",
            "checked_at": datetime.now(UTC).isoformat(),
        }
        try:
            async with asyncio.timeout(5):
                for attempt in range(3):
                    if attempt:
                        await asyncio.sleep(0.5)
                    state = await self.client.async_call_status()
                    result["observed_state"] = state.normalized
                    result["checked_at"] = datetime.now(UTC).isoformat()
                    if state.normalized == "unknown":
                        result["observation"] = "unavailable"
                    elif state.normalized != before:
                        # onCall is busy, never proof of an answered call or audio.
                        result["observation"] = "state_changed"
                        break
                    else:
                        result["observation"] = "unchanged"
        except (HikvisionError, TimeoutError):
            result["observation"] = "unavailable"
        return result
