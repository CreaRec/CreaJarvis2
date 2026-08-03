"""Wake word detectors: microWakeWord, optional openWakeWord, hotkey."""

from __future__ import annotations

import json
import logging
import os
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

import numpy as np

log = logging.getLogger(__name__)

_MWW_RATE = 16_000


class WakeDetector(Protocol):
    def start(self) -> None: ...

    def stop(self) -> None: ...

    def feed_pcm16(self, pcm: bytes, sample_rate: int) -> None: ...


def _pcm16_to_16k(pcm: bytes, sample_rate: int) -> np.ndarray:
    samples = np.frombuffer(pcm, dtype=np.int16)
    if samples.size == 0:
        return samples
    if sample_rate == _MWW_RATE:
        return samples
    if sample_rate < 2 or samples.size < 2:
        return samples[:0]
    # Linear resample (decimate-by-stride aliases badly and tanks wake scores)
    duration = samples.size / float(sample_rate)
    n_out = max(1, int(round(duration * _MWW_RATE)))
    x_old = np.linspace(0.0, 1.0, num=samples.size, endpoint=False)
    x_new = np.linspace(0.0, 1.0, num=n_out, endpoint=False)
    out = np.interp(x_new, x_old, samples.astype(np.float32))
    return np.clip(out, -32768, 32767).astype(np.int16)


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


def _load_mww_config(model_path: Path) -> dict[str, Any]:
    """Read sibling .json from microwakeword-trainer export, else defaults.

    Trainer templates often ship cutoff=0.9 / window=10; this jarvis.tflite
    peaks around ~0.4 on clear speech, so desktop defaults are lower.
    """
    cfg_path = model_path.with_suffix(".json")
    defaults = {
        "wake_word": "Джарвис",
        "probability_cutoff": 0.32,
        "sliding_window_size": 3,
        "trained_languages": ["ru"],
        "min_rms": 500.0,
    }
    if not cfg_path.is_file():
        return defaults
    with cfg_path.open(encoding="utf-8") as fh:
        raw = json.load(fh)
    micro = raw.get("micro") if isinstance(raw.get("micro"), dict) else raw
    out = {
        "wake_word": str(raw.get("wake_word") or defaults["wake_word"]),
        "probability_cutoff": float(
            micro.get("probability_cutoff", defaults["probability_cutoff"])
        ),
        "sliding_window_size": int(
            micro.get("sliding_window_size", defaults["sliding_window_size"])
        ),
        "trained_languages": list(
            micro.get("trained_languages") or defaults["trained_languages"]
        ),
        "min_rms": float(micro.get("min_rms", defaults["min_rms"])),
    }
    env_cut = os.environ.get("JARVIS_WAKE_CUTOFF", "").strip()
    if env_cut:
        out["probability_cutoff"] = float(env_cut)
    env_rms = os.environ.get("JARVIS_WAKE_MIN_RMS", "").strip()
    if env_rms:
        out["min_rms"] = float(env_rms)
    return out


def _pymicro_lib_path() -> Path:
    from pymicro_wakeword.microwakeword import _MODULE_LIB_DIR  # type: ignore

    lib = next(iter(_MODULE_LIB_DIR.glob("*tensorflowlite_c.*")), None)
    if lib is None:
        raise FileNotFoundError("pymicro_wakeword tensorflowlite_c library missing")
    return lib


class MicroWakeWordDetector:
    """Streaming microWakeWord detector for a custom .tflite (e.g. «Джарвис»).

    Uses pymicro-wakeword feature frontend + streaming TFLite inference.
    Audio from AudioIO is 24 kHz; we downsample to 16 kHz.

    This model peaks well below the trainer's 0.9 template cutoff and can
    spike on silence (stateful net) — we gate detections on mic RMS.

    Env:
      JARVIS_WAKE_MODEL=/path/to/jarvis.tflite
      JARVIS_WAKE_CUTOFF=0.32
      JARVIS_WAKE_MIN_RMS=500
      JARVIS_WAKE_DEBUG=1
    """

    def __init__(
        self,
        on_wake: Callable[[], None],
        model_path: Path | None = None,
        *,
        probability_cutoff: float | None = None,
    ) -> None:
        self._on_wake = on_wake
        self._model_path = model_path
        self._cutoff_override = probability_cutoff
        self._enabled = False
        self._mww: Any = None
        self._features: Any = None
        self._available = False
        self._load_error: str | None = None
        self._cooldown = 0
        self._lock = threading.Lock()
        self._pcm_buf = np.zeros(0, dtype=np.int16)
        self._min_rms = 500.0
        self._rms_ema = 0.0
        self._quiet_ticks = 0
        self._debug = os.environ.get("JARVIS_WAKE_DEBUG", "").strip() in (
            "1",
            "true",
            "yes",
        )
        self._dbg_peak = 0.0
        self._dbg_ticks = 0

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
        if self._mww is not None:
            self._available = True
            return
        path = self._model_path
        if path is None or not path.is_file():
            self._load_error = f"model not found: {path}"
            self._available = False
            log.warning("microWakeWord: %s", self._load_error)
            return
        try:
            from pymicro_wakeword import MicroWakeWordFeatures  # type: ignore
            from pymicro_wakeword.microwakeword import MicroWakeWord  # type: ignore

            cfg = _load_mww_config(path)
            cutoff = (
                self._cutoff_override
                if self._cutoff_override is not None
                else float(cfg["probability_cutoff"])
            )
            self._min_rms = float(cfg["min_rms"])
            self._mww = MicroWakeWord(
                id=path.stem,
                wake_word=str(cfg["wake_word"]),
                tflite_model=path,
                probability_cutoff=cutoff,
                sliding_window_size=int(cfg["sliding_window_size"]),
                trained_languages=list(cfg["trained_languages"]),
                libtensorflowlite_c_path=_pymicro_lib_path(),
            )
            self._features = MicroWakeWordFeatures()
            self._available = True
            self._load_error = None
            log.info(
                "microWakeWord streaming ready: %s (%s, cutoff=%.2f, min_rms=%.0f)",
                path,
                cfg["wake_word"],
                cutoff,
                self._min_rms,
            )
        except Exception as err:  # noqa: BLE001
            self._load_error = str(err)
            self._available = False
            self._mww = None
            self._features = None
            log.warning("microWakeWord load failed: %s", err)

    def _reset_stream(self) -> None:
        try:
            if self._mww is not None:
                self._mww.reset()
            if self._features is not None:
                self._features.reset()
        except Exception:  # noqa: BLE001
            pass
        self._pcm_buf = np.zeros(0, dtype=np.int16)
        self._rms_ema = 0.0
        self._quiet_ticks = 0

    def feed_pcm16(self, pcm: bytes, sample_rate: int) -> None:
        if not self._enabled or not self._available:
            return
        if self._mww is None or self._features is None:
            return
        samples = _pcm16_to_16k(pcm, sample_rate)
        if samples.size == 0:
            return
        with self._lock:
            self._pcm_buf = np.concatenate([self._pcm_buf, samples])
            # Feed 10 ms chunks (160 samples @ 16 kHz) as pymicro expects
            frame = 160
            while self._pcm_buf.size >= frame:
                chunk = self._pcm_buf[:frame]
                self._pcm_buf = self._pcm_buf[frame:]
                rms = float(np.sqrt(np.mean(chunk.astype(np.float32) ** 2)))
                self._rms_ema = (0.85 * self._rms_ema) + (0.15 * rms)
                if self._cooldown > 0:
                    self._cooldown -= 1
                    if self._cooldown == 0:
                        self._reset_stream()
                    continue
                # Stateful model spikes on digital silence — only infer on speech energy
                if self._rms_ema < self._min_rms:
                    self._quiet_ticks += 1
                    if self._quiet_ticks >= 20:  # ~200ms quiet → clear state
                        self._quiet_ticks = 0
                        self._reset_stream()
                    continue
                self._quiet_ticks = 0
                audio_bytes = chunk.tobytes()
                try:
                    for features in self._features.process_streaming(audio_bytes):
                        prob = self._mww.process_streaming_prob(features)
                        if prob is None:
                            continue
                        p = float(prob)
                        if self._debug:
                            self._dbg_peak = max(self._dbg_peak, p)
                            self._dbg_ticks += 1
                            if self._dbg_ticks >= 100:
                                log.info(
                                    "microWakeWord debug peak=%.3f rms_ema=%.0f cutoff=%.2f",
                                    self._dbg_peak,
                                    self._rms_ema,
                                    self._mww.probability_cutoff,
                                )
                                self._dbg_peak = 0.0
                                self._dbg_ticks = 0
                        if p < float(self._mww.probability_cutoff):
                            continue
                        self._cooldown = 80
                        self._reset_stream()
                        self._on_wake()
                        return
                except Exception:  # noqa: BLE001
                    continue

    def trigger_test(self) -> None:
        if self._enabled:
            self._on_wake()


class OpenWakeWordJarvis:
    """openWakeWord hey_jarvis — works for «hey jarvis» and often bare «Джарвис».

    Enabled by default on desktop (JARVIS_USE_OPENWAKEWORD=0 to disable).
    Uses onnxruntime on macOS (tflite-runtime wheels are unavailable).

    Cold «Джарвис» scores ~0.05–0.08 (second pass ~0.2+) because OWW's
    embedding buffer needs prior context. We therefore:
      - fire immediately on strong scores (>= strong_threshold)
      - else take the peak over a speech segment and fire on speech end
    """

    def __init__(
        self,
        on_wake: Callable[[], None],
        *,
        threshold: float = 0.05,
        strong_threshold: float = 0.4,
    ) -> None:
        self._on_wake = on_wake
        env_th = os.environ.get("JARVIS_OWW_THRESHOLD", "").strip()
        self._threshold = float(env_th) if env_th else threshold
        env_strong = os.environ.get("JARVIS_OWW_STRONG_THRESHOLD", "").strip()
        self._strong_threshold = (
            float(env_strong) if env_strong else strong_threshold
        )
        self._enabled = False
        self._model = None
        self._available = False
        self._load_error: str | None = None
        self._cooldown = 0
        self._buf = np.zeros(0, dtype=np.int16)
        self._lock = threading.Lock()
        self._rms_ema = 0.0
        self._min_rms = 400.0
        self._in_speech = False
        self._speech_frames = 0
        self._quiet_frames = 0
        self._peak = 0.0

    @property
    def available(self) -> bool:
        return self._available

    @property
    def load_error(self) -> str | None:
        return self._load_error

    def start(self) -> None:
        self._enabled = True
        flag = os.environ.get("JARVIS_USE_OPENWAKEWORD", "1").strip().lower()
        if flag in ("0", "false", "no", "off"):
            self._load_error = "JARVIS_USE_OPENWAKEWORD disabled"
            return
        try:
            import openwakeword  # type: ignore
            from openwakeword.model import Model  # type: ignore

            # Ensure onnx models exist (first run downloads ~few MB)
            try:
                openwakeword.utils.download_models()
            except Exception:  # noqa: BLE001
                pass
            self._model = Model(
                wakeword_models=["hey_jarvis"],
                inference_framework="onnx",
            )
            self._available = True
            self._load_error = None
            log.info(
                "openWakeWord hey_jarvis enabled "
                "(peak>=%.2f / strong>=%.2f) — say «hey jarvis» or «Джарвис»",
                self._threshold,
                self._strong_threshold,
            )
        except Exception as err:  # noqa: BLE001
            self._load_error = str(err)
            self._available = False
            log.warning("openWakeWord unavailable: %s", err)

    def stop(self) -> None:
        self._enabled = False

    def _fire(self) -> None:
        self._cooldown = 25  # ~2s @ 80ms
        self._in_speech = False
        self._speech_frames = 0
        self._quiet_frames = 0
        self._peak = 0.0
        self._on_wake()

    def feed_pcm16(self, pcm: bytes, sample_rate: int) -> None:
        if not self._enabled or not self._available or self._model is None:
            return
        samples = _pcm16_to_16k(pcm, sample_rate)
        if samples.size == 0:
            return

        with self._lock:
            self._buf = np.concatenate([self._buf, samples])
            # openWakeWord expects ~80ms chunks at 16k (1280 samples)
            frame = 1280
            while self._buf.size >= frame:
                chunk = self._buf[:frame]
                self._buf = self._buf[frame:]
                rms = float(np.sqrt(np.mean(chunk.astype(np.float32) ** 2)))
                self._rms_ema = (0.7 * self._rms_ema) + (0.3 * rms)
                # Always run predict so embedding state stays continuous
                try:
                    scores = self._model.predict(chunk)
                except Exception:
                    continue
                score = 0.0
                if isinstance(scores, dict):
                    score = float(max(scores.values())) if scores else 0.0

                if self._cooldown > 0:
                    self._cooldown -= 1
                    continue

                speaking = self._rms_ema >= self._min_rms
                if speaking:
                    self._quiet_frames = 0
                    if not self._in_speech:
                        self._in_speech = True
                        self._speech_frames = 0
                        self._peak = 0.0
                    self._speech_frames += 1
                    self._peak = max(self._peak, score)
                    if score >= self._strong_threshold:
                        self._fire()
                        continue
                else:
                    if self._in_speech:
                        self._quiet_frames += 1
                        # Keep tracking peak during hangover (trailing phonemes)
                        self._peak = max(self._peak, score)
                        self._speech_frames += 1
                        # ~560ms quiet hangover after speech → evaluate peak
                        if self._quiet_frames >= 7:
                            peak = self._peak
                            frames = self._speech_frames
                            self._in_speech = False
                            self._speech_frames = 0
                            self._quiet_frames = 0
                            self._peak = 0.0
                            # ≥ ~240ms of speech and peak above soft threshold
                            if frames >= 3 and peak >= self._threshold:
                                self._fire()
                                continue
                    else:
                        self._quiet_frames = 0


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
