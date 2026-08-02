"""Wake word detectors: microWakeWord, optional openWakeWord, hotkey."""

from __future__ import annotations

import logging
import os
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

import numpy as np

log = logging.getLogger(__name__)


class WakeDetector(Protocol):
    def start(self) -> None: ...

    def stop(self) -> None: ...

    def feed_pcm16(self, pcm: bytes, sample_rate: int) -> None: ...


class HotkeyWake:
    """UI / keyboard wake — same on_wake callback as voice detector."""

    def __init__(self, on_wake: Callable[[], None]) -> None:
        self._on_wake = on_wake
        self._enabled = False

    def start(self) -> None:
        self._enabled = True

    def stop(self) -> None:
        self._enabled = False

    def feed_pcm16(self, pcm: bytes, sample_rate: int) -> None:
        return

    def trigger(self) -> None:
        if self._enabled:
            self._on_wake()


class MicroWakeWordDetector:
    """Loads a microWakeWord .tflite when present.

    Full streaming feature extraction matches the trainer pipeline; until a
    preprocessing companion is wired, presence of the file marks the detector
    as configured. Use HotkeyWake or OpenWakeWordJarvis for day-to-day Mac use.

    Training: see clients/desktop/README.md (phrase «Джарвис»).
    Env: JARVIS_WAKE_MODEL=/path/to/jarvis.tflite
    """

    def __init__(
        self,
        on_wake: Callable[[], None],
        model_path: Path | None = None,
        *,
        probability_cutoff: float = 0.9,
    ) -> None:
        self._on_wake = on_wake
        self._model_path = model_path
        self._cutoff = probability_cutoff
        self._enabled = False
        self._interpreter = None
        self._available = False
        self._load_error: str | None = None

    @property
    def available(self) -> bool:
        return self._available

    @property
    def load_error(self) -> str | None:
        return self._load_error

    def start(self) -> None:
        self._enabled = True
        self._try_load()

    def stop(self) -> None:
        self._enabled = False

    def _try_load(self) -> None:
        if self._interpreter is not None:
            self._available = True
            return
        path = self._model_path
        if path is None or not path.is_file():
            self._load_error = f"model not found: {path}"
            self._available = False
            log.warning("microWakeWord: %s", self._load_error)
            return
        try:
            try:
                from ai_edge_litert.interpreter import Interpreter  # type: ignore
            except ImportError:
                from tflite_runtime.interpreter import Interpreter  # type: ignore
            interpreter = Interpreter(model_path=str(path))
            interpreter.allocate_tensors()
            self._interpreter = interpreter
            self._available = True
            self._load_error = None
            log.info("microWakeWord model file loaded: %s", path)
            log.warning(
                "microWakeWord streaming features not wired yet — "
                "wake via hotkey or JARVIS_USE_OPENWAKEWORD=1 until preprocessor lands",
            )
        except Exception as err:  # noqa: BLE001
            self._load_error = str(err)
            self._available = False
            log.warning("microWakeWord load failed: %s", err)

    def feed_pcm16(self, pcm: bytes, sample_rate: int) -> None:
        # Intentionally no inference without matching spectrogram pipeline
        # (avoids garbage false positives on raw PCM).
        _ = (self._enabled, self._available, pcm, sample_rate, self._cutoff)

    def trigger_test(self) -> None:
        if self._enabled:
            self._on_wake()


class OpenWakeWordJarvis:
    """Optional interim detector: openWakeWord built-in hey_jarvis (EN≈Джарвис).

    Enable with JARVIS_USE_OPENWAKEWORD=1. Requires: pip install openwakeword.
    """

    def __init__(self, on_wake: Callable[[], None], *, threshold: float = 0.5) -> None:
        self._on_wake = on_wake
        self._threshold = threshold
        self._enabled = False
        self._model = None
        self._available = False
        self._load_error: str | None = None
        self._cooldown = 0
        self._buf = np.zeros(0, dtype=np.int16)
        self._lock = threading.Lock()

    @property
    def available(self) -> bool:
        return self._available

    @property
    def load_error(self) -> str | None:
        return self._load_error

    def start(self) -> None:
        self._enabled = True
        if os.environ.get("JARVIS_USE_OPENWAKEWORD", "").strip() not in (
            "1",
            "true",
            "yes",
        ):
            self._load_error = "JARVIS_USE_OPENWAKEWORD not set"
            return
        try:
            from openwakeword.model import Model  # type: ignore

            self._model = Model(wakeword_models=["hey_jarvis"])
            self._available = True
            self._load_error = None
            log.info("openWakeWord hey_jarvis enabled")
        except Exception as err:  # noqa: BLE001
            self._load_error = str(err)
            self._available = False
            log.warning("openWakeWord unavailable: %s", err)

    def stop(self) -> None:
        self._enabled = False

    def feed_pcm16(self, pcm: bytes, sample_rate: int) -> None:
        if not self._enabled or not self._available or self._model is None:
            return
        if sample_rate != 16000:
            # expect 24k from AudioIO — downsample simply
            samples = np.frombuffer(pcm, dtype=np.int16)
            if samples.size < 2:
                return
            ratio = sample_rate / 16000
            idx = (np.arange(0, len(samples), ratio)).astype(np.int64)
            idx = idx[idx < len(samples)]
            samples = samples[idx]
        else:
            samples = np.frombuffer(pcm, dtype=np.int16)

        with self._lock:
            self._buf = np.concatenate([self._buf, samples])
            # openWakeWord expects ~80ms chunks at 16k (1280 samples)
            frame = 1280
            while self._buf.size >= frame:
                chunk = self._buf[:frame]
                self._buf = self._buf[frame:]
                if self._cooldown > 0:
                    self._cooldown -= 1
                    continue
                try:
                    scores = self._model.predict(chunk)
                except Exception:
                    continue
                score = 0.0
                if isinstance(scores, dict):
                    score = float(max(scores.values())) if scores else 0.0
                if score >= self._threshold:
                    self._cooldown = 25
                    self._on_wake()


class CompositeWake:
    def __init__(self, *detectors: WakeDetector) -> None:
        self._detectors = detectors

    def start(self) -> None:
        for d in self._detectors:
            d.start()

    def stop(self) -> None:
        for d in self._detectors:
            d.stop()

    def feed_pcm16(self, pcm: bytes, sample_rate: int) -> None:
        for d in self._detectors:
            d.feed_pcm16(pcm, sample_rate)
