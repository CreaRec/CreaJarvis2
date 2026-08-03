"""Voice Gateway protocol encode/decode (desktop client ↔ core)."""

from __future__ import annotations

import json
from typing import Any


TARGET_RATE = 24_000
ACK_PLAY_TYPE = "ack.play"


def encode(msg: dict[str, Any]) -> str:
    return json.dumps(msg, ensure_ascii=False)


def decode(raw: str | bytes) -> dict[str, Any]:
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    data = json.loads(raw)
    if not isinstance(data, dict) or "type" not in data:
        raise ValueError("Invalid Voice Gateway message")
    return data


def hello(
    *,
    token: str,
    device_id: str,
    display_name: str | None = None,
    voice: bool = True,
    notify: bool = True,
) -> dict[str, Any]:
    msg: dict[str, Any] = {
        "type": "hello",
        "token": token,
        "deviceId": device_id,
        "caps": {"voice": voice, "notify": notify},
    }
    if display_name:
        msg["displayName"] = display_name
    return msg


def session_start() -> dict[str, Any]:
    return {"type": "session.start"}


def session_end() -> dict[str, Any]:
    return {"type": "session.end"}


def audio_append(b64: str) -> dict[str, Any]:
    return {"type": "audio.append", "audio": b64}


def audio_commit() -> dict[str, Any]:
    return {"type": "audio.commit"}


def text_message(text: str) -> dict[str, Any]:
    return {"type": "text", "text": text}


def ack_play() -> dict[str, Any]:
    return {"type": ACK_PLAY_TYPE}
