"""Sustained synthetic audio/access/polling exercise; localhost sockets only.

Run: python tests/soak/run_audio.py --seconds 600 --output .tools/audio-soak.json
This is protocol/lifecycle validation, not HA hardware, acoustic or physical fleet acceptance.
"""

# ruff: noqa: E402
import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[2]), str(Path(__file__).resolve().parents[1])]
from test_access_engine import CAP

from custom_components.hikvision_intercom.access.manager import AccessManager
from custom_components.hikvision_intercom.access.repository import AccessRepository
from custom_components.hikvision_intercom.client.access import AccessClient
from custom_components.hikvision_intercom.client.audio import AudioSession
from custom_components.hikvision_intercom.client.client import (
    ConnectionSettings,
    HikvisionClient,
    create_session,
)
from soak.audio_peer import AudioPeer


async def exercise(seconds, *, cycle_seconds=5):
    peers = [AudioPeer(i) for i in range(9)]
    clients, http, sessions, readers = [], [], [], []
    report = {
        "format": "hikvision_intercom.synthetic_audio_soak",
        "physical_acceptance": False,
        "stations": 9,
        "cycles": 0,
        "polls": 0,
        "writes": 0,
        "faults_observed": 0,
        "max_receive_queue": 0,
        "max_transmit_queue": 0,
        "max_peer_tasks": 0,
        "max_poll_ms": 0,
        "sessions_opened": 0,
        "sessions_closed": 0,
    }

    async def save(_data):
        pass

    repo = AccessRepository(save)
    await repo.async_load(None)
    manager = AccessManager(repo)
    started = time.monotonic()

    async def drain():
        while tasks := [s.task for s in manager.stations.values() if s.task]:
            await asyncio.gather(*tasks)

    async def read_audio(audio):
        while not audio.failure:
            try:
                await audio.receive()
            except Exception:
                return

    try:
        for index, peer in enumerate(peers):
            port = await peer.start()
            settings = ConnectionSettings("127.0.0.1", "soak-user", "soak-secret", port=port)
            session = create_session(settings)
            http.append(session)
            core = HikvisionClient(
                session, settings, expected_identity=peer.identity, enabled_doors=frozenset({1})
            )
            clients.append(core)
            driver = AccessClient(core)
            driver.capabilities = CAP

            async def caps(driver=driver):
                driver.capabilities = CAP
                return CAP

            driver.async_capabilities = caps
            manager.register(str(index), "Synthetic station", True)
            manager.attach(str(index), driver)
        user = await manager.async_create(
            {
                "display_name": "Synthetic Resident",
                "employee_no": "1001",
                "pin": "800000",
                "assignments": {str(i): {"allowed_locks": [1]} for i in range(9)},
            }
        )
        await drain()
        while time.monotonic() - started < seconds or report["cycles"] < 2:
            cycle = report["cycles"]
            selected = [(cycle * 3 + i) % 9 for i in range(3)]
            sessions = [AudioSession(clients[i]) for i in selected]
            await asyncio.gather(*(audio.start() for audio in sessions))
            readers = [asyncio.create_task(read_audio(audio)) for audio in sessions]
            offline = (cycle + 4) % 9
            peers[offline].device.offline = True
            current = repo.get(user["id"])
            await manager.async_update(
                current.id, {"pin": str(800001 + cycle)}, revision=current.revision
            )
            await drain()
            assert repo.snapshot()["retired_pins"], "Offline revocation must remain reserved"
            inject = cycle % 2 == 1
            if inject:
                peers[selected[0]].reject_upload = True
            until = time.monotonic() + cycle_seconds
            while time.monotonic() < until:
                tick = time.monotonic()
                states = await asyncio.gather(*(core.async_call_status() for core in clients))
                assert all(state.normalized == "idle" for state in states)
                report["polls"] += len(states)
                report["max_poll_ms"] = max(report["max_poll_ms"], (time.monotonic() - tick) * 1000)
                report["max_peer_tasks"] = max(
                    report["max_peer_tasks"], sum(len(p.tasks) for p in peers)
                )
                for audio in sessions:
                    report["max_receive_queue"] = max(
                        report["max_receive_queue"], audio.incoming.qsize()
                    )
                    report["max_transmit_queue"] = max(
                        report["max_transmit_queue"], audio.outgoing.qsize()
                    )
                    if not audio.failure:
                        audio.send(b"\xff" * 800)
                await asyncio.sleep(0.1)
            if inject:
                assert sessions[0].failure == "audio_connection_lost"
                assert all(
                    audio.failure is None and audio.received_bytes > 0 for audio in sessions[1:]
                )
                report["faults_observed"] += 1
            else:
                assert all(audio.failure is None and audio.received_bytes > 0 for audio in sessions)
            for reader in readers:
                reader.cancel()
            await asyncio.gather(*readers, return_exceptions=True)
            await asyncio.gather(*(audio.close() for audio in sessions))
            assert all(
                audio.close_confirmed
                and audio.http.is_closed
                and all(t.done() for t in audio._tasks)
                for audio in sessions
            )
            assert all(audio.incoming.empty() and audio.outgoing.empty() for audio in sessions)
            sessions = []
            for peer in peers:
                peer.reject_upload = False
            peers[offline].device.offline = False
            manager.request(str(offline))
            await drain()
            assert not repo.snapshot()["retired_pins"]
            assert all(
                peer.device.users["1001"]["localPassword"] == str(800001 + cycle) for peer in peers
            )
            for peer in peers:
                report["writes"] += len(peer.device.writes)
                peer.device.writes.clear()
            report["cycles"] += 1
        report["elapsed_seconds"] = round(time.monotonic() - started, 2)
    finally:
        for reader in readers:
            reader.cancel()
        await asyncio.gather(*readers, return_exceptions=True)
        await asyncio.gather(*(audio.close() for audio in sessions), return_exceptions=True)
        await manager.async_close()
        await asyncio.gather(*(session.aclose() for session in http))
        await asyncio.gather(*(peer.close() for peer in peers if peer.server))
    report["sessions_opened"] = sum(peer.opens for peer in peers)
    report["sessions_closed"] = sum(peer.closes for peer in peers)
    report["remaining_peer_tasks"] = sum(len(peer.tasks) for peer in peers)
    report["header_errors"] = sum(peer.header_errors for peer in peers)
    report["max_poll_ms"] = round(report["max_poll_ms"], 1)
    assert report["sessions_opened"] == report["sessions_closed"]
    assert not report["remaining_peer_tasks"] and not report["header_errors"]
    assert report["max_peer_tasks"] <= 45
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--seconds", type=int, default=600, choices=range(10, 3601), metavar="10..3600"
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = asyncio.run(exercise(args.seconds))
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
