"""Microphone capture and gapless PCM16 playback for Voice Gateway audio."""

from __future__ import annotations

import base64
import threading
from collections.abc import Callable
from typing import Optional

import numpy as np

from jarvis_client.protocol import TARGET_RATE

try:
    import sounddevice as sd
except (ImportError, OSError):  # pragma: no cover — missing package or PortAudio
    sd = None  # type: ignore


class PlayBuffer:
    """Thread-safe float32 mono sample queue for gapless OutputStream callbacks."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._buf = np.zeros(0, dtype=np.float32)
        self._idle = threading.Event()
        self._idle.set()
        # Require this many samples buffered before we start emitting audio
        # (avoids underrun crackle on the first few tiny Realtime deltas).
        self._prebuffer_frames = 0
        self._primed = False

    def configure_prebuffer(self, frames: int) -> None:
        with self._lock:
            self._prebuffer_frames = max(0, frames)

    def append(self, samples: np.ndarray) -> None:
        if samples.size == 0:
            return
        flat = np.asarray(samples, dtype=np.float32).reshape(-1)
        with self._lock:
            self._idle.clear()
            if self._buf.size == 0:
                self._buf = flat.copy()
            else:
                self._buf = np.concatenate([self._buf, flat])

    def pull(self, frames: int) -> np.ndarray:
        """Return `frames` samples; pad with zeros on underrun."""
        out = np.zeros(frames, dtype=np.float32)
        with self._lock:
            if not self._primed:
                if self._buf.size < self._prebuffer_frames:
                    return out
                self._primed = True

            available = self._buf.size
            if available == 0:
                self._idle.set()
                self._primed = False
                return out

            n = min(frames, available)
            out[:n] = self._buf[:n]
            self._buf = self._buf[n:]
            if self._buf.size == 0:
                self._idle.set()
                self._primed = False
            else:
                self._idle.clear()
        return out

    def clear(self) -> None:
        with self._lock:
            self._buf = np.zeros(0, dtype=np.float32)
            self._primed = False
            self._idle.set()

    def wait_idle(self, timeout: float | None = 60.0) -> bool:
        return self._idle.wait(timeout=timeout)

    @property
    def pending_frames(self) -> int:
        with self._lock:
            return int(self._buf.size)


class AudioIO:
    """24 kHz mono PCM16 capture + gapless OutputStream playback."""

    def __init__(
        self,
        *,
        on_capture: Callable[[bytes], None] | None = None,
        sample_rate: int = TARGET_RATE,
        block_ms: int = 20,
        # ~100ms prebuffer before audible start
        prebuffer_ms: int = 100,
    ) -> None:
        self.sample_rate = sample_rate
        self.block_frames = max(1, int(sample_rate * block_ms / 1000))
        self._on_capture = on_capture
        self._capture_enabled = False
        self._in_stream: Optional[object] = None
        self._out_stream: Optional[object] = None
        self._play = PlayBuffer()
        self._play.configure_prebuffer(int(sample_rate * prebuffer_ms / 1000))

    def set_on_capture(self, cb: Callable[[bytes], None] | None) -> None:
        self._on_capture = cb

    @property
    def capture_enabled(self) -> bool:
        return self._capture_enabled

    def set_capture_enabled(self, enabled: bool) -> None:
        self._capture_enabled = enabled

    def start(self) -> None:
        if sd is None:
            raise RuntimeError("sounddevice is required for AudioIO")
        if self._in_stream is not None:
            return

        def on_in(indata, frames, time_info, status):  # noqa: ANN001
            if not self._capture_enabled or self._on_capture is None:
                return
            mono = indata[:, 0] if indata.ndim > 1 else indata
            pcm = (np.clip(mono, -1.0, 1.0) * 32767.0).astype(np.int16)
            self._on_capture(pcm.tobytes())

        def on_out(outdata, frames, time_info, status):  # noqa: ANN001
            chunk = self._play.pull(frames)
            outdata[:, 0] = chunk

        self._in_stream = sd.InputStream(
            samplerate=self.sample_rate,
            channels=1,
            dtype="float32",
            blocksize=self.block_frames,
            callback=on_in,
        )
        self._out_stream = sd.OutputStream(
            samplerate=self.sample_rate,
            channels=1,
            dtype="float32",
            blocksize=self.block_frames,
            callback=on_out,
        )
        self._in_stream.start()  # type: ignore[union-attr]
        self._out_stream.start()  # type: ignore[union-attr]

    def stop(self) -> None:
        self._capture_enabled = False
        self._play.clear()
        for stream in (self._in_stream, self._out_stream):
            if stream is None:
                continue
            try:
                stream.stop()  # type: ignore[union-attr]
                stream.close()  # type: ignore[union-attr]
            except Exception:
                pass
        self._in_stream = None
        self._out_stream = None

    def enqueue_pcm16_base64(self, b64: str) -> None:
        raw = base64.b64decode(b64)
        if not raw:
            return
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        self._play.append(samples)

    def wait_playback_idle(self, timeout: float | None = 60.0) -> bool:
        return self._play.wait_idle(timeout=timeout)

    def clear_playback(self) -> None:
        self._play.clear()


def pcm16_bytes_to_b64(pcm: bytes) -> str:
    return base64.b64encode(pcm).decode("ascii")


def rms_int16(pcm: bytes) -> float:
    if not pcm:
        return 0.0
    samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32)
    if samples.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(samples * samples)))
