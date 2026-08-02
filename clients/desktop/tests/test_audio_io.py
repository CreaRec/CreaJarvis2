from __future__ import annotations

import numpy as np

from jarvis_client.audio_io import PlayBuffer


def test_play_buffer_gapless_concat() -> None:
    buf = PlayBuffer()
    buf.configure_prebuffer(0)
    buf.append(np.array([0.1, 0.2], dtype=np.float32))
    buf.append(np.array([0.3, 0.4, 0.5], dtype=np.float32))
    out = buf.pull(5)
    assert np.allclose(out, [0.1, 0.2, 0.3, 0.4, 0.5])
    assert buf.wait_idle(0.01)


def test_play_buffer_prebuffer_holds_until_full() -> None:
    buf = PlayBuffer()
    buf.configure_prebuffer(4)
    buf.append(np.array([1.0, 2.0], dtype=np.float32))
    silence = buf.pull(2)
    assert np.allclose(silence, [0.0, 0.0])
    buf.append(np.array([3.0, 4.0], dtype=np.float32))
    out = buf.pull(4)
    assert np.allclose(out, [1.0, 2.0, 3.0, 4.0])


def test_play_buffer_underrun_pads_zeros() -> None:
    buf = PlayBuffer()
    buf.configure_prebuffer(0)
    buf.append(np.array([1.0], dtype=np.float32))
    out = buf.pull(3)
    assert np.allclose(out, [1.0, 0.0, 0.0])
    assert buf.wait_idle(0.01)


def test_play_buffer_clear() -> None:
    buf = PlayBuffer()
    buf.configure_prebuffer(0)
    buf.append(np.array([1.0, 2.0, 3.0], dtype=np.float32))
    buf.clear()
    assert buf.pending_frames == 0
    assert np.allclose(buf.pull(2), [0.0, 0.0])
