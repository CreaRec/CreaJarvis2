from __future__ import annotations

from jarvis_client.protocol import (
    ack_play,
    audio_append,
    decode,
    encode,
    session_start,
)


def test_encode_decode_roundtrip() -> None:
    msg = session_start()
    raw = encode(msg)
    assert decode(raw) == msg


def test_ack_play_shape() -> None:
    assert ack_play() == {"type": "ack.play"}


def test_audio_append() -> None:
    m = audio_append("AAAA")
    assert m["type"] == "audio.append"
    assert m["audio"] == "AAAA"
