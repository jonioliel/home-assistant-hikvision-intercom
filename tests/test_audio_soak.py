"""CI smoke path for the separately runnable sustained loopback exercise."""

import asyncio

from soak.run_audio import exercise


async def test_nine_station_audio_fault_does_not_block_pin_recovery_or_polling():
    async with asyncio.timeout(30):
        report = await exercise(0, cycle_seconds=0.5)
    assert report["sessions_opened"] == report["sessions_closed"] == 6
    assert report["faults_observed"] == 1
    assert report["polls"] >= 18
    assert report["writes"] == 27
    assert report["max_receive_queue"] <= 3 and report["max_transmit_queue"] <= 3
    assert report["remaining_peer_tasks"] == 0
