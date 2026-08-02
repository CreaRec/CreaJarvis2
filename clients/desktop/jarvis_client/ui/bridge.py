"""Thread-safe Qt signal bridge for SessionController callbacks."""

from __future__ import annotations

from PySide6.QtCore import QObject, Signal


class SignalBridge(QObject):
    """Emit from any thread; connect slots that update widgets on the UI thread."""

    log_line = Signal(str)
    state_changed = Signal(str)
    toast = Signal(str, str, str)  # title, body, meta
    connection_changed = Signal(str)  # connected | disconnected | error
