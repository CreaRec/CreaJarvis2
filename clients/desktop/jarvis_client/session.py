"""Orchestrates AudioIO, Gateway, FSM, Ack, Wake."""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

from jarvis_client.ack import RealtimeAckPlayer
from jarvis_client.audio_io import AudioIO, pcm16_bytes_to_b64, rms_int16
from jarvis_client.fsm import State, VoiceFsm
from jarvis_client.gateway import GatewayClient, ResponseDoneWaiter
from jarvis_client.goodbye import is_goodbye_utterance
from jarvis_client import protocol as proto
from jarvis_client.wake import (
    CompositeWake,
    HotkeyWake,
    MicroWakeWordDetector,
    OpenWakeWordJarvis,
)

log = logging.getLogger(__name__)

DEFAULT_MODEL = Path(__file__).resolve().parent.parent / "models" / "jarvis.tflite"


class SessionController:
    def __init__(
        self,
        *,
        gateway_url: str,
        on_log: Callable[[str], None] | None = None,
        on_state: Callable[[str], None] | None = None,
        on_toast: Callable[[str, str, str], None] | None = None,
        loop: asyncio.AbstractEventLoop | None = None,
    ) -> None:
        self.gateway_url = gateway_url
        self._on_log = on_log or (lambda m: log.info("%s", m))
        self._on_state = on_state or (lambda s: None)
        self._on_toast = on_toast
        self._loop = loop

        self._gateway_streaming = False
        self._bytes_sent = 0
        self._chunk_ms = 40.0

        self.audio = AudioIO(on_capture=self._on_pcm)
        self.done_waiter = ResponseDoneWaiter()

        self.fsm = VoiceFsm(
            on_state=self._fsm_state,
            on_start_session=self._start_session,
            on_end_session=self._end_session,
            on_ack_play=self._kick_ack,
            on_commit=self._commit,
            on_mic_gate=self._set_gateway_stream,
        )

        self.gateway = GatewayClient(
            gateway_url,
            on_message=self._on_gateway_message,
            on_close=lambda: self._on_log("gateway closed"),
        )

        self.ack = RealtimeAckPlayer(
            send_ack_play=lambda: self.gateway.send(proto.ack_play()),
            wait_playback_idle=self.audio.wait_playback_idle,
            wait_response_done=self.done_waiter.wait,
        )

        model = Path(os.environ.get("JARVIS_WAKE_MODEL", str(DEFAULT_MODEL)))
        self.hotkey = HotkeyWake(self.fsm.on_wake)
        self.mww = MicroWakeWordDetector(self.fsm.on_wake, model)
        self.oww = OpenWakeWordJarvis(self.fsm.on_wake)
        self.wake = CompositeWake(self.hotkey, self.mww, self.oww)

        self._ack_thread: threading.Thread | None = None
        self._ws_connected = False
        self._end_after_goodbye = False

    def log(self, msg: str) -> None:
        self._on_log(msg)

    def connect_transport(self) -> None:
        """Open WS to gateway (no Realtime until wake)."""
        self.gateway.url = self.gateway_url
        self.gateway.connect()
        self._ws_connected = True
        self.audio.start()
        self.audio.set_capture_enabled(True)  # always capture for wake / VAD
        self.wake.start()
        self.log(f"connected transport {self.gateway_url}")
        if self.mww.available:
            self.log("microWakeWord model present (streaming features TBD)")
        else:
            self.log(f"microWakeWord inactive: {self.mww.load_error}")
        if self.oww.available:
            self.log("openWakeWord hey_jarvis active")
        else:
            self.log("wake: use Wake button / Space (or JARVIS_USE_OPENWAKEWORD=1)")

    def disconnect_transport(self) -> None:
        self.wake.stop()
        self.fsm.force_idle()
        self.audio.stop()
        self.gateway.close()
        self._ws_connected = False
        self.log("disconnected")

    def trigger_wake(self) -> None:
        self.hotkey.trigger()

    def send_text(self, text: str) -> None:
        if not text.strip():
            return
        if not self.gateway.ready:
            self.gateway.start_session()
            # wait briefly for ready in thread
        self.gateway.send(proto.text_message(text.strip()))
        self.fsm.touch()
        self.log(f"text: {text.strip()}")

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop
        self.done_waiter.bind_loop(loop)

    def _fsm_state(self, old: State, new: State) -> None:
        self.log(f"state {old.value} → {new.value}")
        self._on_state(new.value)

    def _set_gateway_stream(self, enabled: bool) -> None:
        self._gateway_streaming = enabled
        if enabled:
            self._bytes_sent = 0

    def _start_session(self) -> None:
        if not self._ws_connected:
            self.connect_transport()
        self.log("session.start")
        self.gateway.start_session()

    def _end_session(self) -> None:
        self.log("session.end")
        self._end_after_goodbye = False
        self.gateway.end_session()
        self.audio.clear_playback()

    def _commit(self) -> None:
        self.log("audio.commit")
        self.gateway.send(proto.audio_commit())

    def _kick_ack(self) -> None:
        def run() -> None:
            try:
                loop = self._loop
                if loop and loop.is_running():
                    fut = asyncio.run_coroutine_threadsafe(self._run_ack(), loop)
                    fut.result(timeout=60)
                else:
                    asyncio.run(self._run_ack())
            except Exception as err:  # noqa: BLE001
                self.log(f"ack failed: {err}")
                self.fsm.on_ack_finished()

        self._ack_thread = threading.Thread(target=run, daemon=True)
        self._ack_thread.start()

    async def _run_ack(self) -> None:
        self.done_waiter.reset()
        if self._loop:
            self.done_waiter.bind_loop(self._loop)
        await self.ack.play()
        self.fsm.on_ack_finished()

    def _on_pcm(self, pcm: bytes) -> None:
        # wake always
        self.wake.feed_pcm16(pcm, proto.TARGET_RATE)
        rms = rms_int16(pcm)
        duration_ms = (len(pcm) / 2) / proto.TARGET_RATE * 1000.0
        # local VAD / EOS
        if self.fsm.state in (State.LISTENING, State.ARMED):
            self.fsm.on_capture_chunk(rms, duration_ms)
        if self._gateway_streaming and self.fsm.stream_to_gateway():
            self._bytes_sent += len(pcm)
            self.gateway.send(proto.audio_append(pcm16_bytes_to_b64(pcm)))

    def _on_gateway_message(self, msg: dict[str, Any]) -> None:
        t = msg.get("type")
        if t == "ready":
            self.log("session ready")
            self.fsm.on_session_ready()
        elif t == "audio.delta":
            audio = msg.get("audio")
            if isinstance(audio, str) and audio:
                self.fsm.on_audio_delta()
                self.audio.enqueue_pcm16_base64(audio)
        elif t == "response.done":
            self.log("response.done")
            self.done_waiter.notify()
            self.fsm.on_response_done()
            # drain playback then armed (or idle after goodbye)
            threading.Thread(target=self._after_response_playback, daemon=True).start()
        elif t == "transcript":
            role = msg.get("role", "?")
            text = msg.get("text", "")
            self.log(f"{role}: {text}")
            if role == "user" and isinstance(text, str) and is_goodbye_utterance(text):
                self._end_after_goodbye = True
                self.log("goodbye phrase — will end session after reply")
        elif t == "error":
            self.log(f"error: {msg.get('message')}")
        elif t == "reminder.fired":
            r = msg.get("reminder") or {}
            self._toast("Напоминание", str(r.get("text", "")), str(r.get("fire_at_local", "")))
        elif t == "reminder.missed_digest":
            lst = msg.get("reminders") or []
            lines = "\n".join(
                f"• {x.get('text')} ({x.get('fire_at_local')})" for x in lst
            )
            body = "Нет" if not lst else f"Пока тебя не было, {len(lst)}:\n{lines}"
            self._toast("Пропущенные напоминания", body, "")
        elif t == "plan.today_digest":
            lst = msg.get("items") or []
            lines = "\n".join(
                f"• {i.get('text')}"
                + (f" ({i.get('scheduled_at_local')})" if i.get("scheduled_at_local") else "")
                for i in lst
            )
            date = msg.get("date", "")
            body = "Пусто" if not lst else f"{date}\n{lines}"
            self._toast("План на сегодня", body, "")

    def _after_response_playback(self) -> None:
        self.audio.wait_playback_idle(120.0)
        if self._end_after_goodbye:
            self.log("goodbye — session.end now")
            self.fsm.force_idle()
            return
        self.fsm.on_playback_drained()

    def _toast(self, title: str, body: str, meta: str) -> None:
        self.log(f"toast: {title}")
        if self._on_toast:
            self._on_toast(title, body, meta)
