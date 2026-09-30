"""Keep administrator write payloads out of HA's raw WebSocket debug logging."""

import logging
from typing import Any


class AccessWebSocketFilter(logging.Filter):
    @staticmethod
    def _redact(value: Any) -> Any:
        # HA 2026.9 logs outgoing websocket messages as already serialized bytes.
        if (isinstance(value, bytes) and b"hikvision_intercom.audio" in value) or (
            isinstance(value, str) and "hikvision_intercom.audio" in value
        ):
            return "Hikvision audio payload REDACTED"
        if (
            isinstance(value, dict)
            and isinstance(value.get("type"), str)
            and value["type"].startswith("hikvision_intercom/")
        ):
            return {"id": value.get("id"), "type": value["type"], "payload": "REDACTED"}
        if isinstance(value, dict) and any(
            isinstance(value.get(key), dict)
            and value[key].get("format") == "hikvision_intercom.audio"
            for key in ("event", "result")
        ):
            return {"id": value.get("id"), "type": value.get("type"), "payload": "REDACTED"}
        if isinstance(value, list):
            return [AccessWebSocketFilter._redact(item) for item in value]
        return value

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(self._redact(arg) for arg in record.args)
        elif isinstance(record.args, dict):
            record.args = self._redact(record.args)
        return True


def install_filter() -> None:
    # Exact logger used by HA 2026.9.1's WebSocketAdapter for inbound command dictionaries.
    logger = logging.getLogger("homeassistant.components.websocket_api.http.connection")
    if not any(isinstance(item, AccessWebSocketFilter) for item in logger.filters):
        logger.addFilter(AccessWebSocketFilter())
