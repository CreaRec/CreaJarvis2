"""Cinematic orb for voice FSM — Three.js via WebEngine, QPainter fallback."""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from pathlib import Path

from PySide6.QtCore import QTimer, QUrl, Qt
from PySide6.QtGui import QColor, QPainter, QPaintEvent, QPen, QRadialGradient
from PySide6.QtWidgets import QSizePolicy, QVBoxLayout, QWidget

from jarvis_client.ui.theme import ACCENT, BG, GLOW

_ORB_WEB_DIR = Path(__file__).resolve().parent / "orb_web"
_ORB_INDEX = _ORB_WEB_DIR / "index.html"


@dataclass(frozen=True)
class OrbVisual:
    """Target visual parameters for a voice FSM state."""

    energy: float
    breath_hz: float
    spin_rps: float
    ring_scale: float
    glow_alpha: int
    core_scale: float


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
        energy=0.55,
        breath_hz=0.4,
        spin_rps=0.14,
        ring_scale=1.02,
        glow_alpha=120,
        core_scale=1.02,
    ),
    "processing": OrbVisual(
        energy=0.5,
        breath_hz=0.38,
        spin_rps=0.16,
        ring_scale=1.02,
        glow_alpha=130,
        core_scale=1.02,
    ),
    "listening": OrbVisual(
        energy=0.55,
        breath_hz=0.45,
        spin_rps=0.1,
        ring_scale=1.06,
        glow_alpha=140,
        core_scale=1.04,
    ),
    "speaking": OrbVisual(
        energy=0.7,
        breath_hz=0.35,
        spin_rps=0.09,
        ring_scale=1.04,
        glow_alpha=160,
        core_scale=1.06,
    ),
}


def visual_for_state(state: str) -> OrbVisual:
    return _STATE_VISUALS.get(state, _DEFAULT)


def _prefer_painter() -> bool:
    """Use 2D painter in tests / when WebEngine is unavailable or forced."""
    if os.environ.get("JARVIS_ORB_2D", "").lower() in {"1", "true", "yes"}:
        return True
    if os.environ.get("QT_QPA_PLATFORM", "") == "offscreen":
        return True
    return False


def _webengine_available() -> bool:
    try:
        from PySide6.QtWebEngineWidgets import QWebEngineView  # noqa: F401
    except ImportError:
        return False
    return _ORB_INDEX.is_file()


class OrbPainterWidget(QWidget):
    """QPainter fallback orb (tests / no WebEngine)."""

    ORB_SIZE = 280
    _TICK_MS = 33
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

    @property
    def backend(self) -> str:
        return "painter"

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

    def paintEvent(self, event: QPaintEvent) -> None:  # noqa: N802
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


class Orb3DWidget(QWidget):
    """Three.js cinematic orb hosted in QWebEngineView."""

    ORB_SIZE = 320

    def __init__(self, parent: QWidget | None = None, *, expanding: bool = False) -> None:
        super().__init__(parent)
        from PySide6.QtWebEngineCore import QWebEngineSettings
        from PySide6.QtWebEngineWidgets import QWebEngineView

        self.setObjectName("orbWidget")
        if expanding:
            self.setMinimumSize(280, 280)
            self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        else:
            self.setFixedSize(self.ORB_SIZE, self.ORB_SIZE)
        self._state = "idle"
        self._page_ready = False

        self._view = QWebEngineView(self)
        self._view.setAttribute(Qt.WidgetAttribute.WA_OpaquePaintEvent, False)
        self._view.page().setBackgroundColor(QColor("#000000"))
        settings = self._view.settings()
        settings.setAttribute(
            QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True
        )
        settings.setAttribute(
            QWebEngineSettings.WebAttribute.JavascriptEnabled, True
        )

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self._view)

        self._view.loadFinished.connect(self._on_load_finished)
        self._view.load(QUrl.fromLocalFile(str(_ORB_INDEX)))

    @property
    def state(self) -> str:
        return self._state

    @property
    def visual(self) -> OrbVisual:
        return visual_for_state(self._state)

    @property
    def backend(self) -> str:
        return "webgl"

    def set_state(self, state: str) -> None:
        self._state = state or "idle"
        self._push_state()

    def _on_load_finished(self, ok: bool) -> None:
        self._page_ready = bool(ok)
        if ok:
            self._push_state()

    def _push_state(self) -> None:
        if not self._page_ready:
            return
        payload = json.dumps(self._state)
        self._view.page().runJavaScript(f"window.setOrbState && window.setOrbState({payload});")


class OrbWidget(QWidget):
    """Public orb: prefers WebGL Three.js, falls back to QPainter."""

    ORB_SIZE = 320

    def __init__(self, parent: QWidget | None = None, *, expanding: bool = False) -> None:
        super().__init__(parent)
        self.setObjectName("orbWidget")

        use_painter = _prefer_painter() or not _webengine_available()
        inner: QWidget
        if use_painter:
            inner = OrbPainterWidget(self)
            self.ORB_SIZE = OrbPainterWidget.ORB_SIZE
        else:
            try:
                inner = Orb3DWidget(self, expanding=expanding)
                self.ORB_SIZE = Orb3DWidget.ORB_SIZE
            except Exception:  # noqa: BLE001
                inner = OrbPainterWidget(self)
                self.ORB_SIZE = OrbPainterWidget.ORB_SIZE

        self._inner = inner
        if expanding and not isinstance(inner, OrbPainterWidget):
            self.setMinimumSize(280, 280)
            self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        else:
            self.setFixedSize(self.ORB_SIZE, self.ORB_SIZE)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(inner)

        # Expose painter timer for tests when using 2D backend
        self._timer = getattr(inner, "_timer", QTimer(self))

    @property
    def state(self) -> str:
        return self._inner.state  # type: ignore[attr-defined]

    @property
    def visual(self) -> OrbVisual:
        return self._inner.visual  # type: ignore[attr-defined]

    @property
    def backend(self) -> str:
        return getattr(self._inner, "backend", "unknown")

    def set_state(self, state: str) -> None:
        self._inner.set_state(state)  # type: ignore[attr-defined]

    def paintEvent(self, event: QPaintEvent) -> None:  # noqa: N802
        # Offscreen tests call paintEvent on the public widget.
        if isinstance(self._inner, OrbPainterWidget):
            self._inner.paintEvent(event)
        else:
            super().paintEvent(event)
