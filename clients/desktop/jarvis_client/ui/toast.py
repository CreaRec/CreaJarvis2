"""In-app toast banner and optional system tray notification."""

from __future__ import annotations

from PySide6.QtCore import QTimer, Qt
from PySide6.QtGui import QIcon, QPixmap, QColor
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QSystemTrayIcon,
    QVBoxLayout,
    QWidget,
)


class ToastBanner(QFrame):
    """Dismissible banner shown at the top of the main panel."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("toastBanner")
        self.setVisible(False)

        self._title = QLabel()
        self._title.setObjectName("toastTitle")
        self._title.setWordWrap(True)

        self._body = QLabel()
        self._body.setObjectName("toastBody")
        self._body.setWordWrap(True)
        self._body.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)

        self._meta = QLabel()
        self._meta.setObjectName("toastMeta")
        self._meta.setWordWrap(True)

        dismiss = QPushButton("OK")
        dismiss.setFixedWidth(64)
        dismiss.clicked.connect(self.hide)

        text_col = QVBoxLayout()
        text_col.setContentsMargins(0, 0, 0, 0)
        text_col.setSpacing(4)
        text_col.addWidget(self._title)
        text_col.addWidget(self._body)
        text_col.addWidget(self._meta)

        row = QHBoxLayout(self)
        row.setContentsMargins(12, 10, 12, 10)
        row.addLayout(text_col, stretch=1)
        row.addWidget(dismiss, alignment=Qt.AlignmentFlag.AlignTop)

        self._auto_hide = QTimer(self)
        self._auto_hide.setSingleShot(True)
        self._auto_hide.timeout.connect(self.hide)

    def show_toast(self, title: str, body: str, meta: str = "") -> None:
        self._title.setText(title)
        self._body.setText(body)
        self._meta.setText(meta)
        self._meta.setVisible(bool(meta))
        self.setVisible(True)
        self._auto_hide.start(12_000)


def make_tray_icon() -> QIcon:
    pix = QPixmap(32, 32)
    pix.fill(QColor("#3dd6c6"))
    return QIcon(pix)


class TrayNotifier:
    """Best-effort tray notifications; banner remains the primary channel."""

    def __init__(self, parent: QWidget) -> None:
        self._tray: QSystemTrayIcon | None = None
        if QSystemTrayIcon.isSystemTrayAvailable():
            self._tray = QSystemTrayIcon(make_tray_icon(), parent)
            self._tray.setToolTip("CreaJarvis")
            self._tray.show()

    def notify(self, title: str, body: str) -> None:
        if self._tray is None:
            return
        snippet = body.replace("\n", " ")[:120]
        self._tray.showMessage(title, snippet, QSystemTrayIcon.MessageIcon.Information, 5000)
