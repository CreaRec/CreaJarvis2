"""Ctrl+C / SIGTERM handling for the Qt desktop shell."""

from __future__ import annotations

import os
import signal

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("JARVIS_ORB_2D", "1")

pytest.importorskip("PySide6")

from PySide6.QtCore import QTimer  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

from jarvis_client.app import install_interrupt_handling  # noqa: E402


@pytest.fixture
def qapp() -> QApplication:
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    return app


def test_install_interrupt_handling_registers_signals_and_timer(qapp: QApplication) -> None:
    prev_int = signal.getsignal(signal.SIGINT)
    prev_term = signal.getsignal(signal.SIGTERM)
    try:
        timer = install_interrupt_handling(qapp)
        assert isinstance(timer, QTimer)
        assert timer.isActive()
        assert timer.interval() == 250
        assert callable(signal.getsignal(signal.SIGINT))
        assert callable(signal.getsignal(signal.SIGTERM))

        # Handler should request application quit (does not raise).
        handler = signal.getsignal(signal.SIGINT)
        assert callable(handler)
        handler(signal.SIGINT, None)  # type: ignore[operator]
    finally:
        signal.signal(signal.SIGINT, prev_int)
        signal.signal(signal.SIGTERM, prev_term)
