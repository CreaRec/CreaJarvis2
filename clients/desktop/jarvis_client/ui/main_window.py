"""Main native window: my-jarvis-style holographic dashboard + debug/settings."""

from __future__ import annotations

import asyncio
import os

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QComboBox,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QPlainTextEdit,
    QPushButton,
    QSizePolicy,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from jarvis_client.device_id import load_or_create_device_id
from jarvis_client.device_meta import (
    default_display_name,
    default_purpose,
    default_room,
    save_device_meta,
)
from jarvis_client.rooms import room_choices
from jarvis_client.session import SessionController
from jarvis_client.ui.bridge import SignalBridge
from jarvis_client.ui.debug_panel import DebugPanel
from jarvis_client.ui.orb import OrbWidget
from jarvis_client.ui.toast import ToastBanner, TrayNotifier
from jarvis_client.weather import current_weather

DEFAULT_WS = os.environ.get("VOICE_GATEWAY_URL", "ws://127.0.0.1:8787/voice")
DEFAULT_TOKEN = os.environ.get("JARVIS_GATEWAY_TOKEN", "")
DEFAULT_DEVICE_NAME = default_display_name()
DEFAULT_DEVICE_ROOM = default_room()
DEFAULT_DEVICE_PURPOSE = default_purpose()
# Refresh orb weather from Core once per hour while the client is open.
WEATHER_REFRESH_MS = 60 * 60 * 1000


class MainWindow(QMainWindow):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle("J.A.R.V.I.S. — CreaJarvis")
        self.resize(1200, 780)

        self._controller: SessionController | None = None
        self.bridge = SignalBridge(self)
        self.bridge.log_line.connect(self._on_log)
        self.bridge.state_changed.connect(self._on_state)
        self.bridge.toast.connect(self._on_toast)
        self.bridge.connection_changed.connect(self._on_connection)

        self._toast_banner = ToastBanner()
        self._tray = TrayNotifier(self)

        # --- Header (my-jarvis style) ---
        brand_dot_outer = QLabel()
        brand_dot_outer.setFixedSize(40, 40)
        brand_dot_outer.setStyleSheet(
            "background: qlineargradient(x1:0,y1:0,x2:1,y2:1,"
            "stop:0 #00E5B0, stop:1 #00AA77); border-radius: 20px;"
        )
        brand_title = QLabel("J.A.R.V.I.S.")
        brand_title.setObjectName("brandTitle")
        brand_sub = QLabel("VOICE ASSISTANT ACTIVE")
        brand_sub.setObjectName("brandSub")
        brand_text = QVBoxLayout()
        brand_text.setSpacing(0)
        brand_text.addWidget(brand_title)
        brand_text.addWidget(brand_sub)

        brand_row = QHBoxLayout()
        brand_row.setSpacing(12)
        brand_row.addWidget(brand_dot_outer)
        brand_row.addLayout(brand_text)
        brand_row.addStretch(1)

        self._fsm_label = QLabel("idle")
        self._fsm_label.setObjectName("fsmLabel")
        self._fsm_label.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self._conn_label = QLabel("OFFLINE")
        self._conn_label.setObjectName("connLabel")
        self._conn_label.setProperty("connState", "offline")
        self._conn_label.setAlignment(Qt.AlignmentFlag.AlignCenter)

        header_right = QHBoxLayout()
        header_right.setSpacing(10)
        header_right.addWidget(self._fsm_label)
        header_right.addWidget(self._conn_label)

        header = QFrame()
        header.setObjectName("hudHeader")
        header_layout = QHBoxLayout(header)
        header_layout.setContentsMargins(16, 10, 16, 10)
        header_layout.addLayout(brand_row, stretch=1)
        header_layout.addLayout(header_right)

        # --- Left: holographic display ---
        self._orb = OrbWidget(expanding=True)
        self._orb.setMinimumHeight(420)
        self._orb.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)

        holo = QFrame()
        holo.setObjectName("holoPanel")
        holo_layout = QVBoxLayout(holo)
        holo_layout.setContentsMargins(0, 0, 0, 0)
        holo_layout.addWidget(self._orb)

        # --- Right: Neural Link ---
        neural_title = QLabel("●  NEURAL LINK")
        neural_title.setObjectName("neuralTitle")

        self._chat = QPlainTextEdit()
        self._chat.setObjectName("neuralChat")
        self._chat.setReadOnly(True)
        self._chat.setPlaceholderText(
            "Systems online.\nSay «Джарвис» or press Wake / Space."
        )

        self._wake_btn = QPushButton("WAKE")
        self._wake_btn.setObjectName("wakeBtn")
        self._wake_btn.clicked.connect(self.do_wake)
        self._disconnect_btn = QPushButton("Disconnect")
        self._disconnect_btn.clicked.connect(self.do_disconnect)
        self._connect_btn = QPushButton("Connect")
        self._connect_btn.clicked.connect(self.do_connect)

        btn_row = QHBoxLayout()
        btn_row.setSpacing(8)
        btn_row.addWidget(self._wake_btn)
        btn_row.addWidget(self._connect_btn)
        btn_row.addWidget(self._disconnect_btn)

        self._text_in = QLineEdit()
        self._text_in.setPlaceholderText("Speak or type a command…")
        self._text_in.returnPressed.connect(self._send_text)
        send_btn = QPushButton("Send")
        send_btn.clicked.connect(self._send_text)
        text_row = QHBoxLayout()
        text_row.addWidget(self._text_in, stretch=1)
        text_row.addWidget(send_btn)

        neural = QFrame()
        neural.setObjectName("holoPanel")
        neural_layout = QVBoxLayout(neural)
        neural_layout.setContentsMargins(14, 14, 14, 14)
        neural_layout.setSpacing(10)
        neural_layout.addWidget(neural_title)
        neural_layout.addWidget(self._chat, stretch=1)
        neural_layout.addLayout(btn_row)
        neural_layout.addLayout(text_row)

        body = QHBoxLayout()
        body.setSpacing(16)
        body.addWidget(holo, stretch=6)
        body.addWidget(neural, stretch=4)

        main_page = QWidget()
        main_layout = QVBoxLayout(main_page)
        main_layout.setSpacing(12)
        main_layout.setContentsMargins(12, 8, 12, 12)
        main_layout.addWidget(self._toast_banner)
        main_layout.addWidget(header)
        main_layout.addLayout(body, stretch=1)

        settings_page = QWidget()
        settings_layout = QVBoxLayout(settings_page)
        settings_layout.addWidget(QLabel("Voice Gateway WebSocket URL"))
        self._ws_input = QLineEdit(DEFAULT_WS)
        settings_layout.addWidget(self._ws_input)
        settings_layout.addWidget(QLabel("Household gateway token"))
        self._token_input = QLineEdit(DEFAULT_TOKEN)
        self._token_input.setEchoMode(QLineEdit.EchoMode.Password)
        self._token_input.setPlaceholderText("JARVIS_GATEWAY_TOKEN")
        settings_layout.addWidget(self._token_input)
        settings_layout.addWidget(QLabel("Device display name (optional)"))
        self._name_input = QLineEdit(DEFAULT_DEVICE_NAME)
        self._name_input.setPlaceholderText("e.g. MacBook")
        settings_layout.addWidget(self._name_input)
        settings_layout.addWidget(QLabel("Room in home (optional)"))
        self._room_combo = QComboBox()
        self._room_combo.addItem("—", "")
        for room_id, label in room_choices():
            self._room_combo.addItem(label, room_id)
        if DEFAULT_DEVICE_ROOM:
            idx = self._room_combo.findData(DEFAULT_DEVICE_ROOM)
            if idx >= 0:
                self._room_combo.setCurrentIndex(idx)
        settings_layout.addWidget(self._room_combo)
        settings_layout.addWidget(QLabel("Purpose (optional)"))
        self._purpose_input = QLineEdit(DEFAULT_DEVICE_PURPOSE)
        self._purpose_input.setPlaceholderText("e.g. рабочий Mac")
        settings_layout.addWidget(self._purpose_input)
        self._device_id_label = QLabel(
            f"Device ID: {load_or_create_device_id()}"
        )
        self._device_id_label.setObjectName("sectionMeta")
        self._device_id_label.setTextInteractionFlags(
            Qt.TextInteractionFlag.TextSelectableByMouse
        )
        settings_layout.addWidget(self._device_id_label)
        settings_hint = QLabel(
            "Set Core LAN URL (ws://HOST:8787/voice) and the same "
            "JARVIS_GATEWAY_TOKEN as on the server, then Connect on Main. "
            "Room/purpose are sent on hello (ADR-006)."
        )
        settings_hint.setObjectName("sectionMeta")
        settings_hint.setWordWrap(True)
        settings_layout.addWidget(settings_hint)
        settings_layout.addStretch(1)

        self._debug = DebugPanel(
            gateway_url_getter=self.gateway_url,
            gateway_token_getter=self.gateway_token,
        )

        tabs = QTabWidget()
        tabs.addTab(main_page, "Main")
        tabs.addTab(settings_page, "Settings")
        tabs.addTab(self._debug, "Debug")
        self.setCentralWidget(tabs)

        QShortcut(QKeySequence(Qt.Key.Key_Space), self, activated=self.do_wake)

        self._update_buttons(connected=False)
        self._apply_conn_style("disconnected")

        self._weather_timer = QTimer(self)
        self._weather_timer.setInterval(WEATHER_REFRESH_MS)
        self._weather_timer.timeout.connect(self._refresh_weather)
        self._weather_timer.start()
        self._push_weather()

    def _push_weather(self) -> None:
        """Feed current weather from Core into the orbital satellite."""
        snap = current_weather(
            gateway_url=self.gateway_url(),
            token=self.gateway_token(),
        )
        self._orb.set_weather(snap.to_payload())

    def _refresh_weather(self) -> None:
        """Hourly refresh from Core."""
        self._push_weather()

    def gateway_url(self) -> str:
        return (self._ws_input.text() or DEFAULT_WS).strip()

    def gateway_token(self) -> str:
        return (self._token_input.text() or "").strip()

    def device_display_name(self) -> str | None:
        name = (self._name_input.text() or "").strip()
        return name or None

    def device_room(self) -> str | None:
        data = self._room_combo.currentData()
        if isinstance(data, str) and data.strip():
            return data.strip()
        return None

    def device_purpose(self) -> str | None:
        purpose = (self._purpose_input.text() or "").strip()
        return purpose or None

    def auto_connect(self) -> None:
        """Connect on startup using VOICE_GATEWAY_URL / Settings field."""
        self.do_connect()

    def do_connect(self) -> None:
        self.do_disconnect()
        url = self.gateway_url()
        token = self.gateway_token()
        display_name = self.device_display_name()
        room = self.device_room()
        purpose = self.device_purpose()
        save_device_meta(
            display_name=display_name,
            room=room,
            purpose=purpose,
        )
        loop = asyncio.get_event_loop()
        c = SessionController(
            gateway_url=url,
            gateway_token=token,
            display_name=display_name,
            room=room,
            purpose=purpose,
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
        msg = (text or "").strip()
        if msg:
            self._append_chat("YOU", msg)
        c.send_text(text or "")
        self._text_in.clear()

    def _append_chat(self, who: str, text: str) -> None:
        self._chat.appendPlainText(f"{who}: {text}")

    def _on_log(self, msg: str) -> None:
        self._debug.append_log(msg)

    def _on_state(self, state: str) -> None:
        self._fsm_label.setText(state.upper())
        self._orb.set_state(state)
        # Color voice-state pill like my-jarvis
        if state == "listening":
            color, bg = "#ff4444", "rgba(255,68,68,0.2)"
        elif state == "speaking":
            color, bg = "#00e5b0", "rgba(0,229,176,0.18)"
        elif state in {"processing", "ack"}:
            color, bg = "#ffaa00", "rgba(255,170,0,0.18)"
        else:
            color, bg = "#00e5b0", "rgba(0,229,176,0.12)"
        self._fsm_label.setStyleSheet(
            f"font-size: 11px; font-weight: 600; letter-spacing: 2px; "
            f"padding: 6px 14px; border-radius: 16px; "
            f"color: {color}; border: 1px solid {color}; background-color: {bg};"
        )

    def _on_toast(self, title: str, body: str, meta: str) -> None:
        self._toast_banner.show_toast(title, body, meta)
        self._tray.notify(title, body)
        self._append_chat("SYSTEM", f"{title}: {body}")

    def _on_connection(self, status: str) -> None:
        self._apply_conn_style(status)
        self._update_buttons(connected=status == "connected")

    def _apply_conn_style(self, status: str) -> None:
        online = status == "connected"
        self._conn_label.setText("ONLINE" if online else "OFFLINE")
        self._conn_label.setObjectName("connOnline" if online else "connOffline")
        # Force stylesheet re-apply for objectName change
        self._conn_label.style().unpolish(self._conn_label)
        self._conn_label.style().polish(self._conn_label)

    def _update_buttons(self, *, connected: bool) -> None:
        self._connect_btn.setVisible(not connected)
        self._disconnect_btn.setEnabled(connected)
        self._wake_btn.setEnabled(connected)

    def closeEvent(self, event) -> None:  # noqa: N802, ANN001
        self.do_disconnect()
        super().closeEvent(event)
