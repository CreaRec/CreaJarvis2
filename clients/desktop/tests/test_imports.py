"""Import-time resilience for headless CI (no PortAudio / no eager UI load)."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_package_init_lazy_loads_main() -> None:
    src = (ROOT / "jarvis_client" / "__init__.py").read_text()
    before_getattr, _, after = src.partition("def __getattr__")
    assert "def __getattr__" in src
    assert "from jarvis_client.app import main" not in before_getattr
    assert "from jarvis_client.app import main" in after


def test_ui_package_init_lazy_loads_main_window() -> None:
    src = (ROOT / "jarvis_client" / "ui" / "__init__.py").read_text()
    before_getattr, _, after = src.partition("def __getattr__")
    assert "def __getattr__" in src
    assert "from jarvis_client.ui.main_window import MainWindow" not in before_getattr
    assert "from jarvis_client.ui.main_window import MainWindow" in after


def test_audio_io_tolerates_portaudio_oserror(monkeypatch: object) -> None:
    import builtins
    import importlib
    import sys

    real_import = builtins.__import__

    def fake_import(name: str, *args: object, **kwargs: object):  # noqa: ANN001
        if name == "sounddevice" or name.startswith("sounddevice."):
            raise OSError("PortAudio library not found")
        return real_import(name, *args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(builtins, "__import__", fake_import)
    sys.modules.pop("sounddevice", None)
    sys.modules.pop("jarvis_client.audio_io", None)
    audio_io = importlib.import_module("jarvis_client.audio_io")
    assert audio_io.sd is None
