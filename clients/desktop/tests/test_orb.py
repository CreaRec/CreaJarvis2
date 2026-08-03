"""Tests for OrbWidget state mapping and paint safety."""

from __future__ import annotations

import os

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("JARVIS_ORB_2D", "1")

pytest.importorskip("PySide6")

from PySide6.QtGui import QPaintEvent  # noqa: E402
from PySide6.QtCore import QRect  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

from jarvis_client.ui.orb import OrbPainterWidget, OrbWidget, visual_for_state  # noqa: E402


@pytest.fixture(scope="module")
def qapp() -> QApplication:
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    return app


def test_visual_for_state_known_and_unknown() -> None:
    idle = visual_for_state("idle")
    listening = visual_for_state("listening")
    speaking = visual_for_state("speaking")
    unknown = visual_for_state("nope")

    assert listening.energy > idle.energy
    assert speaking.glow_alpha > idle.glow_alpha
    assert listening.ring_scale > idle.ring_scale
    assert unknown == idle


def test_busy_states_keep_calm_spin() -> None:
    """processing/ack should read as glow, not a fast spin."""
    idle = visual_for_state("idle")
    processing = visual_for_state("processing")
    ack = visual_for_state("ack")

    assert processing.spin_rps <= idle.spin_rps * 1.15
    assert ack.spin_rps <= idle.spin_rps * 1.15
    assert processing.glow_alpha > idle.glow_alpha
    assert ack.glow_alpha > idle.glow_alpha


def test_set_state_updates_visual(qapp: QApplication) -> None:
    orb = OrbWidget()
    assert orb.backend == "painter"
    assert orb.state == "idle"
    idle_energy = orb.visual.energy

    orb.set_state("processing")
    assert orb.state == "processing"
    assert orb.visual.energy > idle_energy

    orb.set_state("listening")
    assert orb.state == "listening"
    assert orb.visual.ring_scale > visual_for_state("idle").ring_scale
    orb.close()


def test_timer_starts_on_show_stops_on_hide(qapp: QApplication) -> None:
    orb = OrbPainterWidget()
    assert not orb._timer.isActive()
    orb.show()
    qapp.processEvents()
    assert orb._timer.isActive()
    orb.hide()
    qapp.processEvents()
    assert not orb._timer.isActive()
    orb.close()


@pytest.mark.parametrize(
    "state",
    ["idle", "connecting", "armed", "ack", "processing", "listening", "speaking"],
)
def test_paint_event_safe_for_each_state(qapp: QApplication, state: str) -> None:
    orb = OrbPainterWidget()
    orb.set_state(state)
    orb.resize(OrbPainterWidget.ORB_SIZE, OrbPainterWidget.ORB_SIZE)
    orb.paintEvent(QPaintEvent(QRect(0, 0, orb.width(), orb.height())))
    orb.close()


def test_set_weather_safe_on_painter(qapp: QApplication) -> None:
    orb = OrbWidget()
    orb.set_weather(
        {
            "tempC": 12.0,
            "tempLabel": "+12°",
            "icon": "☁",
            "label": "partly cloudy",
            "place": "stub",
        }
    )
    orb.resize(OrbPainterWidget.ORB_SIZE, OrbPainterWidget.ORB_SIZE)
    orb.paintEvent(QPaintEvent(QRect(0, 0, orb.width(), orb.height())))
    orb.set_weather(None)
    orb.paintEvent(QPaintEvent(QRect(0, 0, orb.width(), orb.height())))
    orb.close()


def test_orb_web_assets_present() -> None:
    from jarvis_client.ui import orb as orb_mod

    assert orb_mod._ORB_INDEX.is_file()
    assert (orb_mod._ORB_WEB_DIR / "orb.js").is_file()
    assert (orb_mod._ORB_WEB_DIR / "three.min.js").is_file()
