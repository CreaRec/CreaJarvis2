"""PySide6 desktop shell for CreaJarvis voice client."""

from __future__ import annotations

import asyncio
import os
import sys

import qasync
from PySide6.QtWidgets import QApplication

from jarvis_client.ui.main_window import MainWindow
from jarvis_client.ui.theme import apply_theme


def main() -> None:
    # Offscreen / CI: QT_QPA_PLATFORM=offscreen
    app = QApplication.instance() or QApplication(sys.argv)
    apply_theme(app)

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
