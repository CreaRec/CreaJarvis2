"""Dark holographic HUD palette (my-jarvis / Iron Man inspired)."""

from __future__ import annotations

from PySide6.QtGui import QColor, QFont, QPalette
from PySide6.QtWidgets import QApplication


BG = "#000814"
PANEL = "#06101c"
BORDER = "rgba(255,255,255,0.08)"
BORDER_SOLID = "#1a2a38"
ACCENT = "#00e5b0"
GLOW = "#00aa77"
TEXT = "#e8fff8"
MUTED = "#6a9088"
DANGER = "#ff4444"
OK = "#00dd66"
WARN = "#ffaa00"


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
            border: 1px solid {BORDER_SOLID};
            background: {PANEL};
        }}
        QTabBar::tab {{
            background: {BG};
            color: {MUTED};
            padding: 8px 16px;
            border: 1px solid {BORDER_SOLID};
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
            border: 1px solid {BORDER_SOLID};
            padding: 8px 14px;
            border-radius: 8px;
        }}
        QPushButton:hover {{
            border-color: {ACCENT};
            color: {ACCENT};
        }}
        QPushButton:disabled {{
            color: {MUTED};
            border-color: {BORDER_SOLID};
        }}
        QPushButton#wakeBtn {{
            background-color: rgba(0, 229, 176, 0.15);
            border-color: {ACCENT};
            color: {ACCENT};
            font-weight: 600;
            letter-spacing: 1px;
            min-width: 110px;
        }}
        QPushButton#wakeBtn:hover {{
            background-color: rgba(0, 229, 176, 0.28);
        }}
        QLineEdit, QPlainTextEdit, QTableWidget {{
            background-color: {PANEL};
            color: {TEXT};
            border: 1px solid {BORDER_SOLID};
            border-radius: 8px;
            padding: 8px;
            selection-background-color: {ACCENT};
            selection-color: {BG};
        }}
        QHeaderView::section {{
            background-color: {BG};
            color: {MUTED};
            border: 1px solid {BORDER_SOLID};
            padding: 4px;
        }}
        QFrame#hudHeader {{
            background-color: rgba(255, 255, 255, 0.02);
            border-bottom: 1px solid {BORDER_SOLID};
        }}
        QFrame#holoPanel {{
            background-color: rgba(255, 255, 255, 0.02);
            border: 1px solid {BORDER_SOLID};
            border-radius: 16px;
        }}
        QLabel#brandTitle {{
            font-size: 20px;
            font-weight: 700;
            color: {ACCENT};
            letter-spacing: 4px;
        }}
        QLabel#brandSub {{
            font-size: 10px;
            color: {GLOW};
            letter-spacing: 2px;
        }}
        QLabel#fsmLabel {{
            font-size: 11px;
            font-weight: 600;
            color: {ACCENT};
            letter-spacing: 2px;
            padding: 6px 14px;
            border: 1px solid {ACCENT};
            border-radius: 16px;
            background-color: rgba(0, 229, 176, 0.12);
        }}
        QLabel#connLabel {{
            font-size: 11px;
            letter-spacing: 1px;
            padding: 6px 12px;
            border-radius: 16px;
        }}
        QLabel#connOnline {{
            color: {OK};
            background-color: rgba(0, 200, 100, 0.15);
            border: 1px solid rgba(0, 200, 100, 0.35);
        }}
        QLabel#connOffline {{
            color: {DANGER};
            background-color: rgba(255, 50, 50, 0.15);
            border: 1px solid rgba(255, 50, 50, 0.35);
        }}
        QLabel#neuralTitle {{
            font-size: 13px;
            font-weight: 600;
            color: {ACCENT};
            letter-spacing: 2px;
        }}
        QLabel#chatEmpty {{
            color: {MUTED};
            font-size: 12px;
        }}
        QWidget#orbWidget {{
            background-color: #000000;
            border-radius: 16px;
        }}
        QPlainTextEdit#transcriptLog {{
            font-size: 11px;
            color: {MUTED};
        }}
        QPlainTextEdit#neuralChat {{
            font-size: 12px;
            background-color: transparent;
            border: none;
            color: {TEXT};
        }}
        QFrame#toastBanner {{
            background-color: {PANEL};
            border: 1px solid {ACCENT};
            border-radius: 8px;
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
