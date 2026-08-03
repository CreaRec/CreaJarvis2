"""Persist optional device room/purpose for hello."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from jarvis_client.device_id import config_dir
from jarvis_client.rooms import normalize_room


def device_meta_path() -> Path:
    return config_dir() / "device_meta.json"


def load_device_meta() -> dict[str, str]:
    path = device_meta_path()
    try:
        if not path.is_file():
            return {}
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            return {}
        out: dict[str, str] = {}
        for key in ("display_name", "room", "purpose"):
            val = raw.get(key)
            if isinstance(val, str) and val.strip():
                out[key] = val.strip()
        if "room" in out:
            rid = normalize_room(out["room"])
            if rid:
                out["room"] = rid
            else:
                del out["room"]
        return out
    except (OSError, json.JSONDecodeError):
        return {}


def save_device_meta(
    *,
    display_name: str | None = None,
    room: str | None = None,
    purpose: str | None = None,
) -> None:
    data: dict[str, Any] = {}
    if display_name and display_name.strip():
        data["display_name"] = display_name.strip()
    if room and room.strip():
        rid = normalize_room(room)
        if rid:
            data["room"] = rid
    if purpose and purpose.strip():
        data["purpose"] = purpose.strip()
    path = device_meta_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except OSError:
        pass


def default_display_name() -> str:
    return (
        os.environ.get("JARVIS_DEVICE_NAME", "").strip()
        or load_device_meta().get("display_name", "")
    )


def default_room() -> str:
    raw = (
        os.environ.get("JARVIS_DEVICE_ROOM", "").strip()
        or load_device_meta().get("room", "")
    )
    return normalize_room(raw) or ""


def default_purpose() -> str:
    return (
        os.environ.get("JARVIS_DEVICE_PURPOSE", "").strip()
        or load_device_meta().get("purpose", "")
    )
