"""WebSocket client for Core Voice Gateway."""

from __future__ import annotations

import asyncio
import logging
import threading
from collections.abc import Callable
from typing import Any

import websockets
from websockets.sync.client import connect as sync_connect

from jarvis_client import protocol as proto

log = logging.getLogger(__name__)


class GatewayClient:
    """Thread-friendly sync WebSocket wrapper with async-friendly helpers."""

    def __init__(
        self,
        url: str,
        *,
        on_message: Callable[[dict[str, Any]], None],
        on_close: Callable[[], None] | None = None,
    ) -> None:
        self.url = url
        self._on_message = on_message
        self._on_close = on_close
        self._ws = None
        self._recv_thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self.ready = False

    @property
    def connected(self) -> bool:
        return self._ws is not None

    def connect(self) -> None:
        self.close()
        self.ready = False
        ws = sync_connect(self.url)
        self._ws = ws
        self._recv_thread = threading.Thread(target=self._recv_loop, daemon=True)
        self._recv_thread.start()

    def close(self) -> None:
        with self._lock:
            ws = self._ws
            self._ws = None
            self.ready = False
        if ws is not None:
            try:
                ws.close()
            except Exception:
                pass
        if self._on_close:
            self._on_close()

    def send(self, msg: dict[str, Any]) -> None:
        with self._lock:
            ws = self._ws
        if ws is None:
            return
        try:
            ws.send(proto.encode(msg))
        except Exception as err:
            log.warning("send failed: %s", err)

    def start_session(self) -> None:
        self.ready = False
        self.send(proto.session_start())

    def end_session(self) -> None:
        self.send(proto.session_end())
        self.ready = False

    def _recv_loop(self) -> None:
        ws = self._ws
        if ws is None:
            return
        try:
            for raw in ws:
                try:
                    msg = proto.decode(raw)
                except Exception:
                    continue
                if msg.get("type") == "ready":
                    self.ready = True
                self._on_message(msg)
        except Exception as err:
            log.info("gateway recv ended: %s", err)
        finally:
            self.ready = False
            if self._on_close:
                self._on_close()


class ResponseDoneWaiter:
    """Awaitable one-shot for response.done (used by AckPlayer)."""

    def __init__(self) -> None:
        self._event = asyncio.Event()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def reset(self) -> None:
        self._event = asyncio.Event()

    def notify(self) -> None:
        loop = self._loop
        if loop is None:
            return
        loop.call_soon_threadsafe(self._event.set)

    async def wait(self) -> None:
        try:
            await asyncio.wait_for(self._event.wait(), timeout=30.0)
        except asyncio.TimeoutError:
            pass
