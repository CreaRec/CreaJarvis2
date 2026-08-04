"""Pytest defaults for the desktop client."""

from __future__ import annotations

import os

# Keep UI smoke tests offline and deterministic.
os.environ.setdefault("JARVIS_WEATHER", "0")
