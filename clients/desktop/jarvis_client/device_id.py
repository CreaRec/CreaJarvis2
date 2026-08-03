"""Stable device identity for multi-device Voice Gateway hello."""

from __future__ import annotations

import os
import uuid
from pathlib import Path


def config_dir() -> Path:
    override = os.environ.get("JARVIS_CONFIG_DIR", "").strip()
    if override:
        return Path(override)
    xdg = os.environ.get("XDG_CONFIG_HOME", "").strip()
    if xdg:
        return Path(xdg) / "crea-jarvis"
    return Path.home() / ".config" / "crea-jarvis"


def device_id_path() -> Path:
    return config_dir() / "device_id"


def load_or_create_device_id() -> str:
    path = device_id_path()
    try:
        if path.is_file():
            value = path.read_text(encoding="utf-8").strip()
            if value:
                return value
    except OSError:
        pass
    value = str(uuid.uuid4())
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value + "\n", encoding="utf-8")
    except OSError:
        pass
    return value
