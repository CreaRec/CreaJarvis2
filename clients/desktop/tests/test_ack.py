from __future__ import annotations

import asyncio

from jarvis_client.ack import RealtimeAckPlayer


def test_realtime_ack_player_sends_and_waits() -> None:
    sent: list[int] = []
    idle_calls: list[float | None] = []

    async def wait_done() -> None:
        return None

    player = RealtimeAckPlayer(
        send_ack_play=lambda: sent.append(1),
        wait_playback_idle=lambda t: idle_calls.append(t) or True,
        wait_response_done=wait_done,
    )

    asyncio.run(player.play())
    assert sent == [1]
    assert idle_calls == [30.0]
