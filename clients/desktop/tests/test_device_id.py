"""Tests for persistent device id."""

from __future__ import annotations

from pathlib import Path

from jarvis_client.device_id import load_or_create_device_id


def test_load_or_create_device_id_persists(tmp_path: Path, monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setenv("JARVIS_CONFIG_DIR", str(tmp_path))
    first = load_or_create_device_id()
    second = load_or_create_device_id()
    assert first == second
    assert (tmp_path / "device_id").read_text(encoding="utf-8").strip() == first
