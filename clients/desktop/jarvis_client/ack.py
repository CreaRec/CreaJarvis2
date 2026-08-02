"""Acknowledgment player port — Realtime now, local wav later."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Protocol


class AckPlayer(Protocol):
    async def play(self) -> None: ...

    def cancel(self) -> None: ...


class RealtimeAckPlayer:
    """Sends ack.play and waits until playback is idle."""

    def __init__(
        self,
        *,
        send_ack_play: Callable[[], None],
        wait_playback_idle: Callable[[float | None], bool],
        wait_response_done: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        self._send = send_ack_play
        self._wait_playback = wait_playback_idle
        self._wait_response = wait_response_done
        self._cancelled = False

    async def play(self) -> None:
        self._cancelled = False
        self._send()
        if self._wait_response is not None:
            await self._wait_response()
        if self._cancelled:
            return
        self._wait_playback(30.0)

    def cancel(self) -> None:
        self._cancelled = True
