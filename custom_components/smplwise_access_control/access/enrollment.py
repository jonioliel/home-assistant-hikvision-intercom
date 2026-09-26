"""Ephemeral, administrator-owned card collection with explicit revision-bound approval."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from ..client.capture import CapturedCard, CardCaptureClient
from ..exceptions import HikvisionTimeoutError, HikvisionUnsupportedError
from .models import AccessError, text_field

if TYPE_CHECKING:
    from .manager import AccessManager

SESSION_SECONDS = 120
MAX_SESSIONS = 3


@dataclass(slots=True, repr=False)
class CaptureSession:
    id: str
    actor: str
    station_id: str
    user_id: str
    revision: int
    reader_id: int
    state: str = "preparing"
    card: CapturedCard | None = None
    error: str | None = None
    task: asyncio.Task[None] | None = None
    timer: asyncio.TimerHandle | None = None

    def public(self) -> dict[str, Any]:
        return {
            "session_id": self.id,
            "station_id": self.station_id,
            "user_id": self.user_id,
            "revision": self.revision,
            "state": self.state,
            "error": self.error,
            "card": self.card.public() if self.card else None,
        }


class CardEnrollment:
    def __init__(self, manager: AccessManager) -> None:
        self.manager = manager
        self.sessions: dict[str, CaptureSession] = {}

    def _client(self, station_id: str) -> CardCaptureClient:
        if self.manager._closed:
            raise AccessError("manager_closed")
        station = self.manager._station(station_id)
        return CardCaptureClient(self.manager._driver(station).client)

    def _get(self, session_id: str, actor: str) -> CaptureSession:
        session = self.sessions.get(session_id)
        if session is None or session.actor != actor:
            raise AccessError("capture_not_found")
        return session

    async def capabilities(self, station_id: str) -> dict[str, Any]:
        try:
            async with asyncio.timeout(35):
                return (await self._client(station_id).async_capabilities()).public()
        except HikvisionUnsupportedError:
            raise AccessError("capture_unsupported") from None

    def start(
        self, station_id: str, user_id: str, revision: int, reader_id: int, actor: str
    ) -> dict[str, Any]:
        self._client(station_id)
        user = self.manager.repository.get(user_id)
        if type(revision) is not int or revision != user.revision:
            raise AccessError("revision_conflict")
        if not actor or type(reader_id) is not int or not 0 <= reader_id <= 8:
            raise AccessError("invalid_fields")
        if any(s.station_id == station_id for s in self.sessions.values()):
            raise AccessError("capture_station_busy")
        if len(self.sessions) >= MAX_SESSIONS:
            raise AccessError("capture_limit")
        session = CaptureSession(uuid4().hex, actor, station_id, user_id, revision, reader_id)
        self.sessions[session.id] = session
        session.timer = asyncio.get_running_loop().call_later(
            SESSION_SECONDS, self._expire, session.id
        )
        session.task = self.manager._task_factory(
            self._collect(session), "Hikvision card collection"
        )
        return session.public()

    async def _collect(self, session: CaptureSession) -> None:
        try:
            async with asyncio.timeout(70):
                client = self._client(session.station_id)
                caps = await client.async_capabilities()
                if session.reader_id not in caps.readers:
                    raise AccessError("capture_reader_invalid")
                card = await client.async_capture(
                    caps, session.reader_id, on_waiting=lambda: setattr(session, "state", "waiting")
                )
                if self.sessions.get(session.id) is session:
                    session.card, session.state = card, "captured"
        except asyncio.CancelledError:
            raise
        except Exception as err:
            # Never retain raw exceptions/device messages or expose credential content.
            session.state, session.card = "error", None
            session.error = (
                "capture_timeout"
                if isinstance(err, (TimeoutError, HikvisionTimeoutError))
                else "capture_unsupported"
                if isinstance(err, HikvisionUnsupportedError)
                else err.code
                if isinstance(err, AccessError)
                else "capture_failed"
            )
        finally:
            session.task = None

    def status(self, session_id: str, actor: str) -> dict[str, Any]:
        return self._get(session_id, actor).public()

    def _expire(self, session_id: str) -> None:
        session = self.sessions.get(session_id)
        if session is not None and session.state != "applying":
            self._drop(session)

    def _drop(self, session: CaptureSession) -> asyncio.Task[None] | None:
        self.sessions.pop(session.id, None)
        if session.timer:
            session.timer.cancel()
        session.card = None
        if session.task:
            session.task.cancel()
        return session.task

    async def cancel(self, session_id: str, actor: str) -> None:
        session = self.sessions.get(session_id)
        if session is None:
            return
        session = self._get(session_id, actor)
        if session.state == "applying":
            raise AccessError("capture_applying")
        task = self._drop(session)
        if task:
            await asyncio.gather(task, return_exceptions=True)

    async def close_station(self, station_id: str) -> None:
        tasks = []
        for session in list(self.sessions.values()):
            if session.station_id == station_id and session.state != "applying":
                task = self._drop(session)
                if task:
                    tasks.append(task)
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def confirm(self, session_id: str, actor: str, label: str) -> dict[str, Any]:
        session = self._get(session_id, actor)
        if session.state != "captured" or session.card is None:
            raise AccessError("capture_not_ready")
        label = text_field(label, 64, empty=True)
        try:
            user = self.manager.repository.get(session.user_id)
        except AccessError:
            self._drop(session)
            raise
        if user.revision != session.revision:
            self._drop(session)
            raise AccessError("revision_conflict")
        number = session.card.number
        if any(card.card_no.value == number for card in user.cards):
            self._drop(session)
            raise AccessError("card_conflict")
        # The captured technology is not the access-control cardType enum.
        cards = [
            {"id": card.id, "label": card.label, "enabled": card.enabled} for card in user.cards
        ]
        cards.append(
            {"card_no": number, "label": label, "card_type": "normalCard", "enabled": True}
        )
        session.state = "applying"
        try:
            return await self.manager.async_update(
                user.id, {"cards": cards}, revision=session.revision
            )
        finally:
            self._drop(session)
