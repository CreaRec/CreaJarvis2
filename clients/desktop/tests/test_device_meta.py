"""Tests for persisted device meta (room/purpose)."""

from __future__ import annotations

from pathlib import Path

from jarvis_client.device_meta import load_device_meta, save_device_meta


def test_save_and_load_device_meta(tmp_path: Path, monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setenv("JARVIS_CONFIG_DIR", str(tmp_path))
    save_device_meta(
        display_name="Mac",
        room="кабинет",
        purpose="работа",
    )
    meta = load_device_meta()
    assert meta == {
        "display_name": "Mac",
        "room": "office",
        "purpose": "работа",
    }
    assert (tmp_path / "device_meta.json").is_file()


def test_save_omits_empty_and_unknown_room(
    tmp_path: Path, monkeypatch
) -> None:  # noqa: ANN001
    monkeypatch.setenv("JARVIS_CONFIG_DIR", str(tmp_path))
    save_device_meta(display_name="Mac", room="basement", purpose=None)
    assert load_device_meta() == {"display_name": "Mac"}


def test_load_normalizes_legacy_alias(
    tmp_path: Path, monkeypatch
) -> None:  # noqa: ANN001
    monkeypatch.setenv("JARVIS_CONFIG_DIR", str(tmp_path))
    (tmp_path / "device_meta.json").write_text(
        '{"room": "кухня"}\n', encoding="utf-8"
    )
    assert load_device_meta() == {"room": "kitchen_living"}
