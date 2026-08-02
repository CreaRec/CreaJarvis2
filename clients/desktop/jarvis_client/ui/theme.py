"""Dark HUD palette for the native desktop shell."""

from __future__ import annotations

from PySide6.QtGui import QColor, QFont, QPalette
from PySide6.QtWidgets import QApplication


BG = "#0b1220"
PANEL = "#121a2b"
BORDER = "#1e2a44"
ACCENT = "#3dd6c6"
TEXT = "#e8eef9"
MUTED = "#8b9bb8"
DANGER = "#f07178"
OK = "#7fd99a"


def apply_theme(app: QApplication) -> None:
    app.setStyle("Fusion")
    pal = QPalette()
    bg = QColor(BG)
    panel = QColor(PANEL)
    text = QColor(TEXT)
    muted = QColor(MUTED)
    accent = QColor(ACCENT)

    pal.setColor(QPalette.ColorRole.Window, bg)
    pal.setColor(QPalette.ColorRole.WindowText, text)
    pal.setColor(QPalette.ColorRole.Base, panel)
    pal.setColor(QPalette.ColorRole.AlternateBase, bg)
    pal.setColor(QPalette.ColorRole.Text, text)
    pal.setColor(QPalette.ColorRole.Button, panel)
    pal.setColor(QPalette.ColorRole.ButtonText, text)
    pal.setColor(QPalette.ColorRole.Highlight, accent)
    pal.setColor(QPalette.ColorRole.HighlightedText, bg)
    pal.setColor(QPalette.ColorRole.PlaceholderText, muted)
    pal.setColor(QPalette.ColorRole.ToolTipBase, panel)
    pal.setColor(QPalette.ColorRole.ToolTipText, text)
    app.setPalette(pal)

    font = QFont("Menlo")
    if not font.exactMatch():
        font = QFont("Consolas")
    if not font.exactMatch():
        font = QFont("monospace")
    font.setPointSize(12)
    app.setFont(font)

    app.setStyleSheet(
        f"""
        QMainWindow, QWidget {{
            background-color: {BG};
            color: {TEXT};
        }}
        QTabWidget::pane {{
            border: 1px solid {BORDER};
            background: {PANEL};
        }}
        QTabBar::tab {{
            background: {BG};
            color: {MUTED};
            padding: 8px 16px;
            border: 1px solid {BORDER};
            border-bottom: none;
            margin-right: 2px;
        }}
        QTabBar::tab:selected {{
            background: {PANEL};
            color: {ACCENT};
        }}
        QPushButton {{
            background-color: {PANEL};
            color: {TEXT};
            border: 1px solid {BORDER};
            padding: 8px 14px;
            border-radius: 4px;
        }}
        QPushButton:hover {{
            border-color: {ACCENT};
            color: {ACCENT};
        }}
        QPushButton:disabled {{
            color: {MUTED};
            border-color: {BORDER};
        }}
        QLineEdit, QPlainTextEdit, QTableWidget {{
            background-color: {PANEL};
            color: {TEXT};
            border: 1px solid {BORDER};
            border-radius: 4px;
            padding: 6px;
            selection-background-color: {ACCENT};
            selection-color: {BG};
        }}
        QHeaderView::section {{
            background-color: {BG};
            color: {MUTED};
            border: 1px solid {BORDER};
            padding: 4px;
        }}
        QLabel#fsmLabel {{
            font-size: 28px;
            font-weight: 600;
            color: {ACCENT};
            letter-spacing: 1px;
        }}
        QLabel#connLabel {{
            color: {MUTED};
            font-size: 13px;
        }}
        QFrame#toastBanner {{
            background-color: {PANEL};
            border: 1px solid {ACCENT};
            border-radius: 6px;
        }}
        QLabel#toastTitle {{
            color: {ACCENT};
            font-weight: 600;
            font-size: 14px;
        }}
        QLabel#toastBody {{
            color: {TEXT};
        }}
        QLabel#toastMeta {{
            color: {MUTED};
            font-size: 11px;
        }}
        QLabel#sectionMeta {{
            color: {MUTED};
        }}
        """
    )
