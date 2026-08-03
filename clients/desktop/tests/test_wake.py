from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from jarvis_client.wake import (
    HotkeyWake,
    MicroWakeWordDetector,
    OpenWakeWordJarvis,
    _load_mww_config,
    _pcm16_to_16k,
)

MODEL = Path(__file__).resolve().parent.parent / "models" / "jarvis.tflite"


def test_hotkey_wake_fires_when_started() -> None:
    hits: list[int] = []
    w = HotkeyWake(lambda: hits.append(1))
    w.trigger()
    assert hits == []
    w.start()
    w.trigger()
    assert hits == [1]
    w.stop()
    w.trigger()
    assert hits == [1]


def test_pcm16_downsample_24k_to_16k() -> None:
    pcm = np.arange(24, dtype=np.int16).tobytes()
    out = _pcm16_to_16k(pcm, 24_000)
    assert out.dtype == np.int16
    assert len(out) == 16


def test_load_mww_config_defaults(tmp_path: Path) -> None:
    model = tmp_path / "x.tflite"
    model.write_bytes(b"x")
    cfg = _load_mww_config(model)
    assert cfg["wake_word"] == "Джарвис"
    assert cfg["probability_cutoff"] == 0.32
    assert cfg["min_rms"] == 500.0


def test_load_mww_config_from_json(tmp_path: Path) -> None:
    model = tmp_path / "x.tflite"
    model.write_bytes(b"x")
    (tmp_path / "x.json").write_text(
        '{"wake_word":"test","micro":{"probability_cutoff":0.5,'
        '"sliding_window_size":3,"min_rms":100}}',
        encoding="utf-8",
    )
    cfg = _load_mww_config(model)
    assert cfg["wake_word"] == "test"
    assert cfg["probability_cutoff"] == 0.5
    assert cfg["sliding_window_size"] == 3
    assert cfg["min_rms"] == 100.0


def test_microwakeword_missing_model() -> None:
    d = MicroWakeWordDetector(lambda: None, model_path=Path("/no/such/jarvis.tflite"))
    d.start()
    assert d.available is False
    assert d.load_error is not None
    assert "model not found" in d.load_error


@pytest.mark.skipif(not MODEL.is_file(), reason="models/jarvis.tflite not present")
def test_microwakeword_loads_real_model() -> None:
    d = MicroWakeWordDetector(lambda: None, model_path=MODEL)
    d.start()
    assert d.available is True
    assert d.load_error is None
    assert d._mww is not None


@pytest.mark.skipif(not MODEL.is_file(), reason="models/jarvis.tflite not present")
def test_microwakeword_silence_does_not_wake() -> None:
    hits: list[int] = []
    d = MicroWakeWordDetector(lambda: hits.append(1), model_path=MODEL)
    d.start()
    assert d.available is True
    silence = np.zeros(24_000 * 2, dtype=np.int16).tobytes()
    d.feed_pcm16(silence, 24_000)
    assert hits == []


def test_microwakeword_skips_inference_when_quiet() -> None:
    hits: list[int] = []
    d = MicroWakeWordDetector(lambda: hits.append(1), model_path=Path("/unused"))
    d._enabled = True
    d._available = True
    d._min_rms = 500.0
    d._pcm_buf = np.zeros(0, dtype=np.int16)

    mww = MagicMock()
    mww.probability_cutoff = 0.3
    mww.process_streaming_prob.return_value = 0.99
    feats = MagicMock()
    feats.process_streaming.return_value = [np.zeros((1, 1, 40))]
    d._mww = mww
    d._features = feats

    quiet = np.zeros(160, dtype=np.int16).tobytes()
    for _ in range(30):
        d.feed_pcm16(quiet, 16_000)
    assert hits == []
    feats.process_streaming.assert_not_called()

    loud = (np.full(160, 3000, dtype=np.int16)).tobytes()
    for _ in range(30):
        d.feed_pcm16(loud, 16_000)
        if hits:
            break
    assert hits == [1]
    feats.process_streaming.assert_called()


def test_microwakeword_reports_load_error(tmp_path: Path) -> None:
    model = tmp_path / "jarvis.tflite"
    model.write_bytes(b"fake")
    with patch(
        "jarvis_client.wake._pymicro_lib_path",
        side_effect=RuntimeError("lib missing"),
    ):
        d = MicroWakeWordDetector(lambda: None, model_path=model)
        d.start()
    assert d.available is False
    assert d.load_error is not None
    assert "lib missing" in d.load_error


def test_oww_fires_on_speech_end_peak() -> None:
    hits: list[int] = []
    d = OpenWakeWordJarvis(lambda: hits.append(1), threshold=0.05, strong_threshold=0.9)
    d._enabled = True
    d._available = True
    model = MagicMock()
    # Loud frames with soft peak, then enough quiet hangover → fire on EOS
    scores = [0.01, 0.04, 0.06, 0.07] + [0.02] * 12
    model.predict.side_effect = [{"hey_jarvis": s} for s in scores]
    d._model = model
    loud = np.full(1280, 3000, dtype=np.int16).tobytes()
    quiet = np.zeros(1280, dtype=np.int16).tobytes()
    for _ in range(4):
        d.feed_pcm16(loud, 16_000)
    assert hits == []
    for _ in range(12):
        d.feed_pcm16(quiet, 16_000)
    assert hits == [1]


def test_oww_fires_immediately_on_strong_score() -> None:
    hits: list[int] = []
    d = OpenWakeWordJarvis(lambda: hits.append(1), threshold=0.05, strong_threshold=0.4)
    d._enabled = True
    d._available = True
    model = MagicMock()
    model.predict.return_value = {"hey_jarvis": 0.95}
    d._model = model
    loud = np.full(1280, 3000, dtype=np.int16).tobytes()
    d.feed_pcm16(loud, 16_000)
    # need a couple frames for rms_ema to enter speech
    d.feed_pcm16(loud, 16_000)
    d.feed_pcm16(loud, 16_000)
    assert hits == [1]
