"""Session state machine for wake → ack → listen → speak → armed → idle."""

from __future__ import annotations

import enum
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field


class State(enum.Enum):
    IDLE = "idle"
    CONNECTING = "connecting"
    ACK = "ack"
    LISTENING = "listening"
    PROCESSING = "processing"
    SPEAKING = "speaking"
    ARMED = "armed"


IDLE_TIMEOUT_S = 5 * 60
# Silence after speech before commit
SILENCE_EOS_MS = 700
MIN_UTTERANCE_MS = 250
SPEECH_RMS_THRESHOLD = 500.0


@dataclass
class FsmConfig:
    idle_timeout_s: float = IDLE_TIMEOUT_S
    silence_eos_ms: float = SILENCE_EOS_MS
    min_utterance_ms: float = MIN_UTTERANCE_MS
    speech_rms_threshold: float = SPEECH_RMS_THRESHOLD


@dataclass
class VoiceFsm:
    """Pure-ish FSM; side effects via callbacks."""

    config: FsmConfig = field(default_factory=FsmConfig)
    on_state: Callable[[State, State], None] | None = None
    on_start_session: Callable[[], None] | None = None
    on_end_session: Callable[[], None] | None = None
    on_ack_play: Callable[[], None] | None = None
    on_commit: Callable[[], None] | None = None
    on_mic_gate: Callable[[bool], None] | None = None  # True = allow capture→gateway

    state: State = State.IDLE
    _last_active: float = field(default_factory=time.monotonic)
    _lock: threading.Lock = field(default_factory=threading.Lock)
    _utterance_ms: float = 0.0
    _silence_ms: float = 0.0
    _heard_speech: bool = False
    _idle_timer: threading.Timer | None = None

    def mic_allowed(self) -> bool:
        return self.state in (State.LISTENING, State.ARMED)

    def stream_to_gateway(self) -> bool:
        """Only LISTENING streams to Realtime; ARMED waits for speech then listens."""
        return self.state == State.LISTENING

    def _set_state(self, new: State) -> None:
        old = self.state
        if old == new:
            return
        self.state = new
        if self.on_mic_gate:
            self.on_mic_gate(self.stream_to_gateway())
        if self.on_state:
            self.on_state(old, new)

    def touch(self) -> None:
        self._last_active = time.monotonic()
        self._arm_idle_timer()

    def _arm_idle_timer(self) -> None:
        if self._idle_timer:
            self._idle_timer.cancel()
            self._idle_timer = None
        if self.state == State.IDLE:
            return

        def fire() -> None:
            with self._lock:
                if self.state == State.IDLE:
                    return
                if time.monotonic() - self._last_active < self.config.idle_timeout_s:
                    self._arm_idle_timer()
                    return
                self._go_idle(end_session=True)

        self._idle_timer = threading.Timer(self.config.idle_timeout_s, fire)
        self._idle_timer.daemon = True
        self._idle_timer.start()

    def on_wake(self) -> None:
        with self._lock:
            if self.state not in (State.IDLE, State.ARMED):
                return
            self.touch()
            if self.state == State.ARMED:
                self._begin_listening()
                return
            self._set_state(State.CONNECTING)
            if self.on_start_session:
                self.on_start_session()

    def on_session_ready(self) -> None:
        with self._lock:
            if self.state != State.CONNECTING:
                return
            self.touch()
            self._set_state(State.ACK)
            if self.on_mic_gate:
                self.on_mic_gate(False)
            if self.on_ack_play:
                self.on_ack_play()

    def on_ack_finished(self) -> None:
        with self._lock:
            if self.state != State.ACK:
                return
            self.touch()
            self._begin_listening()

    def _begin_listening(self) -> None:
        self._utterance_ms = 0.0
        self._silence_ms = 0.0
        self._heard_speech = False
        self._set_state(State.LISTENING)

    def on_capture_chunk(self, rms: float, duration_ms: float) -> None:
        """Feed energy for silence EOS while LISTENING, or speech detect while ARMED."""
        with self._lock:
            if self.state == State.ARMED:
                if rms >= self.config.speech_rms_threshold:
                    self.touch()
                    self._begin_listening()
                    # fall through to treat this chunk as start of utterance
                else:
                    return

            if self.state != State.LISTENING:
                return

            speaking = rms >= self.config.speech_rms_threshold
            if speaking:
                self._heard_speech = True
                self._utterance_ms += duration_ms
                self._silence_ms = 0.0
                self.touch()
            elif self._heard_speech:
                self._silence_ms += duration_ms
                if (
                    self._silence_ms >= self.config.silence_eos_ms
                    and self._utterance_ms >= self.config.min_utterance_ms
                ):
                    self._set_state(State.PROCESSING)
                    if self.on_mic_gate:
                        self.on_mic_gate(False)
                    if self.on_commit:
                        self.on_commit()

    def on_audio_delta(self) -> None:
        with self._lock:
            if self.state in (State.PROCESSING, State.SPEAKING, State.ACK):
                if self.state == State.PROCESSING:
                    self._set_state(State.SPEAKING)
                self.touch()

    def on_response_done(self) -> None:
        """Called when gateway sends response.done; wait for playback separately."""
        with self._lock:
            if self.state == State.PROCESSING:
                # text-only / empty audio
                self._enter_armed()
            elif self.state == State.SPEAKING:
                pass  # wait playback drained
            elif self.state == State.ACK:
                pass

    def on_playback_drained(self) -> None:
        with self._lock:
            if self.state == State.ACK:
                # ack path uses on_ack_finished explicitly
                return
            if self.state in (State.SPEAKING, State.PROCESSING):
                self._enter_armed()

    def _enter_armed(self) -> None:
        self.touch()
        self._set_state(State.ARMED)
        if self.on_mic_gate:
            # ARMED: capture for local VAD only; gateway stream off until speech
            self.on_mic_gate(False)

    def force_idle(self) -> None:
        with self._lock:
            self._go_idle(end_session=True)

    def _go_idle(self, *, end_session: bool) -> None:
        if self._idle_timer:
            self._idle_timer.cancel()
            self._idle_timer = None
        self._set_state(State.IDLE)
        if self.on_mic_gate:
            self.on_mic_gate(False)
        if end_session and self.on_end_session:
            self.on_end_session()
