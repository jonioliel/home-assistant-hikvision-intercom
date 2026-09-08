"""Documented card collection, gated by fresh device capabilities (vendor pages 87/481)."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from ..exceptions import HikvisionUnsupportedError, HikvisionValidationError
from .access import validate_card
from .client import HikvisionClient
from .parser import find_values, parse_payload

TECHNOLOGIES = frozenset({"TypeA_M1", "TypeA_CPU", "TypeB", "ID_125K", "FelicaCard", "DesfireCard"})


def bounds(value: Any, *, ceiling: int) -> tuple[int, int]:
    if not isinstance(value, dict):
        raise HikvisionValidationError("Missing collection bounds")
    low, high = value.get("@min"), value.get("@max")
    if type(low) is not int or type(high) is not int or not 1 <= low <= high <= ceiling:
        raise HikvisionValidationError("Invalid collection bounds")
    return low, high


@dataclass(frozen=True, slots=True)
class CaptureCapabilities:
    card_min: int
    card_max: int
    readers: tuple[int, ...]
    technologies: frozenset[str]

    @classmethod
    def parse(cls, access: dict[str, Any], payload: dict[str, Any]) -> CaptureCapabilities:
        flags = find_values(access, "isSupportCaptureCardInfo")
        if len(flags) != 1 or not (flags[0] is True or flags[0] == "true"):
            raise HikvisionUnsupportedError("Card collection is not advertised")
        cap = payload.get("CardInfoCap")
        if not isinstance(cap, dict):
            raise HikvisionUnsupportedError("Card collection capabilities missing")
        low, high = bounds(cap["cardNo"], ceiling=32) if "cardNo" in cap else (1, 32)
        # Zero is an internal UI sentinel: omit readerID, as in the documented workflow.
        if "readerID" in cap:
            first, last = bounds(cap["readerID"], ceiling=8)
            readers = tuple(range(first, last + 1))
        else:
            readers = (0,)
        kinds = cap.get("cardType", [])
        if not isinstance(kinds, list) or any(
            not isinstance(k, str) or k not in TECHNOLOGIES for k in kinds
        ):
            raise HikvisionUnsupportedError("Unknown collection card technology")
        return cls(low, high, readers, frozenset(kinds))

    def public(self) -> dict[str, Any]:
        return {"readers": list(self.readers), "card_min": self.card_min, "card_max": self.card_max}


@dataclass(frozen=True, slots=True, repr=False)
class CapturedCard:
    number: str = field(repr=False)
    technology: str | None
    reader_id: int | None

    def public(self) -> dict[str, Any]:
        return {
            "masked_number": "•••• " + self.number[-4:] if len(self.number) > 4 else "••••",
            "technology": self.technology,
            "reader_id": self.reader_id,
        }


class CardCaptureClient:
    def __init__(self, client: HikvisionClient) -> None:
        self.client = client

    async def async_capabilities(self) -> CaptureCapabilities:
        await self.client.async_confirm_identity()
        access = await self.client._get("/ISAPI/AccessControl/capabilities")
        flags = find_values(access, "isSupportCaptureCardInfo")
        if len(flags) != 1 or not (flags[0] is True or flags[0] == "true"):
            raise HikvisionUnsupportedError("Card collection is not advertised")
        payload = await self.client._get(
            "/ISAPI/AccessControl/CaptureCardInfo/capabilities?format=json"
        )
        return CaptureCapabilities.parse(access, payload)

    async def async_capture(
        self,
        caps: CaptureCapabilities,
        reader_id: int,
        *,
        on_waiting: Callable[[], None] | None = None,
    ) -> CapturedCard:
        if type(reader_id) is not int or reader_id not in caps.readers:
            raise HikvisionValidationError("Reader is not advertised")
        await self.client.async_confirm_identity()
        # Collection can wait for presentation. Borrow the pooled session with its own IO
        # lane so a waiting collector never holds the normal poll/snapshot/release lock.
        collector = HikvisionClient(self.client._session, self.client.settings)
        path = "/ISAPI/AccessControl/CaptureCardInfo?format=json"
        if reader_id:
            path += f"&readerID={reader_id}"
        if on_waiting is not None:
            on_waiting()
        body = await collector._request("GET", path, deadline=30)
        payload = parse_payload(body).data.get("CardInfo")
        if not isinstance(payload, dict):
            raise HikvisionValidationError("Missing collected card")
        number = validate_card(payload.get("cardNo"), minimum=caps.card_min, maximum=caps.card_max)
        technology, source = payload.get("cardType"), payload.get("readerID")
        if technology is not None and (
            not isinstance(technology, str)
            or technology not in TECHNOLOGIES
            or caps.technologies
            and technology not in caps.technologies
        ):
            raise HikvisionValidationError("Unknown collected technology")
        if source is not None and (
            type(source) is not int or not 1 <= source <= 8 or reader_id and source != reader_id
        ):
            raise HikvisionValidationError("Collected reader does not match request")
        return CapturedCard(number, technology, source)
