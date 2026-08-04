"""Offscreen Qt tests for signal bridge and MainWindow smoke."""

from __future__ import annotations

import os

import pytest

# Ensure headless Qt before importing PySide6 widgets.
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("JARVIS_ORB_2D", "1")

pytest.importorskip("PySide6")

from PySide6.QtWidgets import QApplication  # noqa: E402

from jarvis_client.ui.bridge import SignalBridge  # noqa: E402
from jarvis_client.ui.main_window import (  # noqa: E402
    WEATHER_REFRESH_MS,
    MainWindow,
)


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


def test_main_window_smoke(
    qapp: QApplication, monkeypatch: pytest.MonkeyPatch
) -> None:
    from jarvis_client.weather import STUB_WEATHER

    monkeypatch.setattr(
        "jarvis_client.ui.main_window.current_weather",
        lambda **_kwargs: STUB_WEATHER,
    )
    win = MainWindow()
    assert "J.A.R.V.I.S" in win.windowTitle()
    assert win._fsm_label.text() == "idle"
    assert win._conn_label.text() == "OFFLINE"
    assert win._orb.state == "idle"
    # Weather bead is pushed into the orbital satellite on startup (stub in tests).
    assert getattr(win._orb._inner, "_weather", None) is not None
    assert win._orb._inner._weather["tempLabel"] == "+12°"
    assert win._weather_timer.isActive()
    assert win._weather_timer.interval() == WEATHER_REFRESH_MS
    assert WEATHER_REFRESH_MS == 60 * 60 * 1000
    # Drive bridge without connecting transport
    win.bridge.state_changed.emit("armed")
    win.bridge.toast.emit("Напоминание", "tea", "15:00")
    qapp.processEvents()
    assert win._fsm_label.text() == "ARMED"
    assert win._orb.state == "armed"
    win.bridge.state_changed.emit("listening")
    qapp.processEvents()
    assert win._orb.state == "listening"
    assert win._fsm_label.text() == "LISTENING"
    # Logs go to Debug, not Main
    win.bridge.log_line.emit("session note")
    qapp.processEvents()
    assert "session note" in win._debug.log.toPlainText()
    assert "session note" not in win._chat.toPlainText()
    # Parent window is not shown in offscreen smoke; isHidden tracks setVisible.
    assert not win._toast_banner.isHidden()
    assert win._toast_banner._title.text() == "Напоминание"
    win.close()


def test_weather_hourly_refresh_from_core(
    qapp: QApplication, monkeypatch: pytest.MonkeyPatch
) -> None:
    from jarvis_client.weather import WeatherSnapshot

    calls = {"n": 0}
    snaps = [
        WeatherSnapshot(temp_c=12.0, icon="", label="partly cloudy", place="stub"),
        WeatherSnapshot(temp_c=21.0, icon="0", label="clear", place="Austin"),
    ]

    def fake_weather(**_kwargs: object) -> WeatherSnapshot:
        i = min(calls["n"], len(snaps) - 1)
        calls["n"] += 1
        return snaps[i]

    monkeypatch.setattr(
        "jarvis_client.ui.main_window.current_weather", fake_weather
    )

    win = MainWindow()
    assert calls["n"] == 1
    assert win._orb._inner._weather["tempLabel"] == "+12°"

    win._refresh_weather()
    qapp.processEvents()
    assert calls["n"] == 2
    assert win._orb._inner._weather["tempLabel"] == "+21°"
    win.close()
