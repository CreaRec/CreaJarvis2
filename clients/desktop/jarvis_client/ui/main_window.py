"""Main native window: voice UX + debug tab."""

from __future__ import annotations

import asyncio
import os
from datetime import datetime

from PySide6.QtCore import Qt
from PySide6.QtGui import QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QPlainTextEdit,
    QPushButton,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from jarvis_client.session import SessionController
from jarvis_client.ui.bridge import SignalBridge
from jarvis_client.ui.debug_panel import DebugPanel
from jarvis_client.ui.toast import ToastBanner, TrayNotifier

DEFAULT_WS = os.environ.get("VOICE_GATEWAY_URL", "ws://127.0.0.1:8787/voice")
_MAX_LOG_LINES = 500


class MainWindow(QMainWindow):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle("CreaJarvis Desktop")
        self.resize(900, 720)

        self._controller: SessionController | None = None
        self.bridge = SignalBridge(self)
        self.bridge.log_line.connect(self._on_log)
        self.bridge.state_changed.connect(self._on_state)
        self.bridge.toast.connect(self._on_toast)
        self.bridge.connection_changed.connect(self._on_connection)

        self._toast_banner = ToastBanner()
        self._tray = TrayNotifier(self)

        self._fsm_label = QLabel("idle")
        self._fsm_label.setObjectName("fsmLabel")
        self._fsm_label.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self._conn_label = QLabel("disconnected")
        self._conn_label.setObjectName("connLabel")
        self._conn_label.setAlignment(Qt.AlignmentFlag.AlignCenter)

        hint = QLabel("Say «Джарвис» when a wake model is loaded, or press Wake / Space.")
        hint.setObjectName("sectionMeta")
        hint.setAlignment(Qt.AlignmentFlag.AlignCenter)
        hint.setWordWrap(True)

        self._wake_btn = QPushButton("Wake (Space)")
        self._wake_btn.clicked.connect(self.do_wake)
        self._disconnect_btn = QPushButton("Disconnect")
        self._disconnect_btn.clicked.connect(self.do_disconnect)
        self._connect_btn = QPushButton("Connect")
        self._connect_btn.clicked.connect(self.do_connect)

        btn_row = QHBoxLayout()
        btn_row.addStretch(1)
        btn_row.addWidget(self._wake_btn)
        btn_row.addWidget(self._connect_btn)
        btn_row.addWidget(self._disconnect_btn)
        btn_row.addStretch(1)

        self._text_in = QLineEdit()
        self._text_in.setPlaceholderText("Text message")
        self._text_in.returnPressed.connect(self._send_text)
        send_btn = QPushButton("Send")
        send_btn.clicked.connect(self._send_text)
        text_row = QHBoxLayout()
        text_row.addWidget(self._text_in, stretch=1)
        text_row.addWidget(send_btn)

        self._log = QPlainTextEdit()
        self._log.setReadOnly(True)
        self._log.setMaximumBlockCount(_MAX_LOG_LINES)

        main_page = QWidget()
        main_layout = QVBoxLayout(main_page)
        main_layout.setSpacing(12)
        main_layout.addWidget(self._toast_banner)
        main_layout.addWidget(QLabel("CreaJarvis"))
        main_layout.addWidget(self._fsm_label)
        main_layout.addWidget(self._conn_label)
        main_layout.addWidget(hint)
        main_layout.addLayout(btn_row)
        main_layout.addLayout(text_row)
        main_layout.addWidget(self._log, stretch=1)

        settings_page = QWidget()
        settings_layout = QVBoxLayout(settings_page)
        settings_layout.addWidget(QLabel("Voice Gateway WebSocket URL"))
        self._ws_input = QLineEdit(DEFAULT_WS)
        settings_layout.addWidget(self._ws_input)
        settings_hint = QLabel(
            "Change the URL here, then Connect on the main tab. "
            "Default comes from VOICE_GATEWAY_URL."
        )
        settings_hint.setObjectName("sectionMeta")
        settings_hint.setWordWrap(True)
        settings_layout.addWidget(settings_hint)
        settings_layout.addStretch(1)

        self._debug = DebugPanel(gateway_url_getter=self.gateway_url)

        tabs = QTabWidget()
        tabs.addTab(main_page, "Main")
        tabs.addTab(settings_page, "Settings")
        tabs.addTab(self._debug, "Debug")
        self.setCentralWidget(tabs)

        QShortcut(QKeySequence(Qt.Key.Key_Space), self, activated=self.do_wake)

        self._update_buttons(connected=False)

    def gateway_url(self) -> str:
        return (self._ws_input.text() or DEFAULT_WS).strip()

    def auto_connect(self) -> None:
        """Connect on startup using VOICE_GATEWAY_URL / Settings field."""
        self.do_connect()

    def do_connect(self) -> None:
        self.do_disconnect()
        url = self.gateway_url()
        loop = asyncio.get_event_loop()
        c = SessionController(
            gateway_url=url,
            on_log=lambda m: self.bridge.log_line.emit(m),
            on_state=lambda s: self.bridge.state_changed.emit(s),
            on_toast=lambda t, b, m: self.bridge.toast.emit(t, b, m),
            loop=loop,
        )
        c.bind_loop(loop)
        self._controller = c
        try:
            c.connect_transport()
            self.bridge.connection_changed.emit("connected")
        except Exception as err:  # noqa: BLE001
            self.bridge.log_line.emit(f"connect failed: {err}")
            self.bridge.connection_changed.emit("error")

    def do_disconnect(self) -> None:
        c = self._controller
        if c:
            c.disconnect_transport()
            self._controller = None
        self.bridge.connection_changed.emit("disconnected")
        self.bridge.state_changed.emit("idle")

    def do_wake(self) -> None:
        # Avoid Space triggering wake while typing in text fields
        focus = self.focusWidget()
        if isinstance(focus, QLineEdit) or (
            isinstance(focus, QPlainTextEdit) and not focus.isReadOnly()
        ):
            return
        c = self._controller
        if not c:
            self.bridge.log_line.emit("connect first")
            return
        c.trigger_wake()

    def _send_text(self) -> None:
        c = self._controller
        text = self._text_in.text()
        if not c:
            self.bridge.log_line.emit("connect first")
            return
        c.send_text(text or "")
        self._text_in.clear()

    def _on_log(self, msg: str) -> None:
        stamp = datetime.now().strftime("%H:%M:%S")
        self._log.appendPlainText(f"[{stamp}] {msg}")

    def _on_state(self, state: str) -> None:
        self._fsm_label.setText(state)

    def _on_toast(self, title: str, body: str, meta: str) -> None:
        self._toast_banner.show_toast(title, body, meta)
        self._tray.notify(title, body)

    def _on_connection(self, status: str) -> None:
        self._conn_label.setText(status)
        self._update_buttons(connected=status == "connected")

    def _update_buttons(self, *, connected: bool) -> None:
        self._connect_btn.setVisible(not connected)
        self._disconnect_btn.setEnabled(connected)
        self._wake_btn.setEnabled(connected)

    def closeEvent(self, event) -> None:  # noqa: N802, ANN001
        self.do_disconnect()
        super().closeEvent(event)
