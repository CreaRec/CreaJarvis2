"""PySide6 desktop shell for CreaJarvis voice client."""

from __future__ import annotations

import asyncio
import os
import signal
import sys

# Qt WebEngine must be imported before QApplication on some platforms.
try:
    from PySide6.QtWebEngineWidgets import QWebEngineView  # noqa: F401
except ImportError:
    pass

import qasync
from PySide6.QtCore import QTimer
from PySide6.QtWidgets import QApplication

from jarvis_client.ui.main_window import MainWindow
from jarvis_client.ui.theme import apply_theme


def install_interrupt_handling(app: QApplication) -> QTimer:
    """Make Ctrl+C / SIGTERM quit the Qt event loop.

    Qt blocks in C++ so Python's default SIGINT handler never runs unless the
    interpreter is woken periodically. A no-op QTimer yields to Python so the
    installed handlers can call ``app.quit()``.
    """

    def _quit(*_args: object) -> None:
        app.quit()

    signal.signal(signal.SIGINT, _quit)
    signal.signal(signal.SIGTERM, _quit)

    # Wake the interpreter ~4×/s so pending signals are delivered.
    keepalive = QTimer(app)
    keepalive.setInterval(250)
    keepalive.timeout.connect(lambda: None)
    keepalive.start()
    return keepalive


def main() -> None:
    # Offscreen / CI: QT_QPA_PLATFORM=offscreen
    # Force 2D orb: JARVIS_ORB_2D=1
    app = QApplication.instance() or QApplication(sys.argv)
    apply_theme(app)
    install_interrupt_handling(app)

    loop = qasync.QEventLoop(app)
    asyncio.set_event_loop(loop)

    window = MainWindow()
    window.show()

    # Autoconnect unless disabled (e.g. tests can set JARVIS_AUTO_CONNECT=0)
    if os.environ.get("JARVIS_AUTO_CONNECT", "1") not in {"0", "false", "False"}:
        window.auto_connect()

    with loop:
        loop.run_forever()


if __name__ in {"__main__", "__mp_main__"}:
    main()
