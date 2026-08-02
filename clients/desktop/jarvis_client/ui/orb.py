"""Animated cinematic orb for voice FSM state visualization."""

from __future__ import annotations

import math
from dataclasses import dataclass

from PySide6.QtCore import QTimer, Qt
from PySide6.QtGui import QColor, QPainter, QPen, QRadialGradient
from PySide6.QtWidgets import QWidget

from jarvis_client.ui.theme import ACCENT, BG, GLOW


@dataclass(frozen=True)
class OrbVisual:
    """Target visual parameters for a voice FSM state."""

    energy: float  # 0–1+ overall intensity
    breath_hz: float  # pulse frequency
    spin_rps: float  # revolutions per second for orbit dots
    ring_scale: float  # outer ring radius multiplier
    glow_alpha: int  # 0–255 soft glow opacity
    core_scale: float  # core disc size multiplier


_DEFAULT = OrbVisual(
    energy=0.35,
    breath_hz=0.35,
    spin_rps=0.08,
    ring_scale=0.92,
    glow_alpha=50,
    core_scale=0.85,
)

_STATE_VISUALS: dict[str, OrbVisual] = {
    "idle": _DEFAULT,
    "connecting": OrbVisual(
        energy=0.4,
        breath_hz=0.45,
        spin_rps=0.12,
        ring_scale=0.94,
        glow_alpha=60,
        core_scale=0.88,
    ),
    "armed": OrbVisual(
        energy=0.55,
        breath_hz=0.55,
        spin_rps=0.15,
        ring_scale=1.0,
        glow_alpha=90,
        core_scale=0.95,
    ),
    "ack": OrbVisual(
        energy=0.85,
        breath_hz=1.1,
        spin_rps=0.45,
        ring_scale=1.05,
        glow_alpha=140,
        core_scale=1.05,
    ),
    "processing": OrbVisual(
        energy=0.9,
        breath_hz=1.2,
        spin_rps=0.5,
        ring_scale=1.06,
        glow_alpha=150,
        core_scale=1.08,
    ),
    "listening": OrbVisual(
        energy=1.0,
        breath_hz=0.8,
        spin_rps=0.28,
        ring_scale=1.18,
        glow_alpha=170,
        core_scale=1.1,
    ),
    "speaking": OrbVisual(
        energy=1.15,
        breath_hz=1.6,
        spin_rps=0.35,
        ring_scale=1.12,
        glow_alpha=200,
        core_scale=1.15,
    ),
}


def visual_for_state(state: str) -> OrbVisual:
    return _STATE_VISUALS.get(state, _DEFAULT)


class OrbWidget(QWidget):
    """QPainter orb that reacts to voice FSM state strings."""

    ORB_SIZE = 260
    _TICK_MS = 33  # ~30 fps
    _DOT_COUNT = 12

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setFixedSize(self.ORB_SIZE, self.ORB_SIZE)
        self.setObjectName("orbWidget")
        self._state = "idle"
        self._visual = visual_for_state(self._state)
        self._phase = 0.0
        self._spin = 0.0

        self._timer = QTimer(self)
        self._timer.setInterval(self._TICK_MS)
        self._timer.timeout.connect(self._on_tick)

    @property
    def state(self) -> str:
        return self._state

    @property
    def visual(self) -> OrbVisual:
        return self._visual

    def set_state(self, state: str) -> None:
        self._state = state or "idle"
        self._visual = visual_for_state(self._state)
        self.update()

    def showEvent(self, event) -> None:  # noqa: N802, ANN001
        super().showEvent(event)
        if not self._timer.isActive():
            self._timer.start()

    def hideEvent(self, event) -> None:  # noqa: N802, ANN001
        self._timer.stop()
        super().hideEvent(event)

    def _on_tick(self) -> None:
        dt = self._TICK_MS / 1000.0
        self._phase += 2.0 * math.pi * self._visual.breath_hz * dt
        self._spin += 2.0 * math.pi * self._visual.spin_rps * dt
        if self._phase > 2.0 * math.pi * 100:
            self._phase %= 2.0 * math.pi
        if self._spin > 2.0 * math.pi * 100:
            self._spin %= 2.0 * math.pi
        self.update()

    def paintEvent(self, event) -> None:  # noqa: N802, ANN001
        del event
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        w, h = self.width(), self.height()
        cx, cy = w / 2.0, h / 2.0
        base_r = min(w, h) * 0.32

        breath = 0.5 + 0.5 * math.sin(self._phase)
        energy = self._visual.energy
        pulse = 1.0 + 0.06 * breath * energy
        ring_r = base_r * self._visual.ring_scale * pulse
        core_r = base_r * 0.42 * self._visual.core_scale * (1.0 + 0.04 * breath)

        accent = QColor(ACCENT)
        glow = QColor(GLOW)
        bg = QColor(BG)

        # Soft radial glow
        glow_r = ring_r * 1.55
        grad = QRadialGradient(cx, cy, glow_r)
        g = QColor(glow)
        g.setAlpha(int(self._visual.glow_alpha * (0.7 + 0.3 * breath)))
        grad.setColorAt(0.0, g)
        outer = QColor(glow)
        outer.setAlpha(0)
        grad.setColorAt(1.0, outer)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(grad)
        painter.drawEllipse(
            int(cx - glow_r),
            int(cy - glow_r),
            int(glow_r * 2),
            int(glow_r * 2),
        )

        # Concentric rings
        for i, scale in enumerate((1.0, 0.78, 0.58)):
            r = ring_r * scale
            pen = QPen(accent)
            alpha = int((110 - i * 28) * (0.55 + 0.45 * energy))
            c = QColor(accent)
            c.setAlpha(max(20, min(255, alpha)))
            pen.setColor(c)
            pen.setWidthF(1.4 if i == 0 else 1.0)
            painter.setPen(pen)
            painter.setBrush(Qt.BrushStyle.NoBrush)
            painter.drawEllipse(int(cx - r), int(cy - r), int(r * 2), int(r * 2))

        # Orbiting dots
        painter.setPen(Qt.PenStyle.NoPen)
        for i in range(self._DOT_COUNT):
            ang = self._spin + (2.0 * math.pi * i / self._DOT_COUNT)
            orbit = ring_r * (0.88 + 0.06 * math.sin(ang * 2 + self._phase))
            x = cx + math.cos(ang) * orbit
            y = cy + math.sin(ang) * orbit
            size = 2.2 + 1.6 * energy * (0.5 + 0.5 * math.sin(ang + self._phase))
            dc = QColor(accent)
            dc.setAlpha(int(140 + 80 * energy))
            painter.setBrush(dc)
            painter.drawEllipse(
                int(x - size),
                int(y - size),
                int(size * 2),
                int(size * 2),
            )

        # Core disc
        core_grad = QRadialGradient(cx - core_r * 0.25, cy - core_r * 0.25, core_r * 1.2)
        bright = QColor(accent)
        bright.setAlpha(230)
        mid = QColor(glow)
        mid.setAlpha(200)
        dark = QColor(bg)
        dark.setAlpha(220)
        core_grad.setColorAt(0.0, bright)
        core_grad.setColorAt(0.45, mid)
        core_grad.setColorAt(1.0, dark)
        painter.setBrush(core_grad)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.drawEllipse(
            int(cx - core_r),
            int(cy - core_r),
            int(core_r * 2),
            int(core_r * 2),
        )
