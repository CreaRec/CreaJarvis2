"""Offscreen Qt tests for signal bridge and MainWindow smoke."""

from __future__ import annotations

import os

import pytest

# Ensure headless Qt before importing PySide6 widgets.
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

pytest.importorskip("PySide6")

from PySide6.QtWidgets import QApplication  # noqa: E402

from jarvis_client.ui.bridge import SignalBridge  # noqa: E402
from jarvis_client.ui.main_window import MainWindow  # noqa: E402


@pytest.fixture(scope="module")
def qapp() -> QApplication:
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    return app


def test_signal_bridge_emits_to_slots(qapp: QApplication) -> None:
    bridge = SignalBridge()
    logs: list[str] = []
    states: list[str] = []
    toasts: list[tuple[str, str, str]] = []

    bridge.log_line.connect(logs.append)
    bridge.state_changed.connect(states.append)
    bridge.toast.connect(lambda t, b, m: toasts.append((t, b, m)))

    bridge.log_line.emit("hello")
    bridge.state_changed.emit("listening")
    bridge.toast.emit("Title", "Body", "meta")

    qapp.processEvents()

    assert logs == ["hello"]
    assert states == ["listening"]
    assert toasts == [("Title", "Body", "meta")]


def test_main_window_smoke(qapp: QApplication) -> None:
    win = MainWindow()
    assert win.windowTitle() == "CreaJarvis Desktop"
    assert win._fsm_label.text() == "idle"
    assert win._conn_label.text() == "disconnected"
    assert win._orb.state == "idle"
    # Drive bridge without connecting transport
    win.bridge.state_changed.emit("armed")
    win.bridge.toast.emit("Напоминание", "tea", "15:00")
    qapp.processEvents()
    assert win._fsm_label.text() == "armed"
    assert win._orb.state == "armed"
    win.bridge.state_changed.emit("listening")
    qapp.processEvents()
    assert win._orb.state == "listening"
    # Parent window is not shown in offscreen smoke; isHidden tracks setVisible.
    assert not win._toast_banner.isHidden()
    assert win._toast_banner._title.text() == "Напоминание"
    win.close()
