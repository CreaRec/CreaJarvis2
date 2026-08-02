"""Debug tables for reminders / plans / themes."""

from __future__ import annotations

from collections.abc import Callable

import httpx
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from jarvis_client.http_util import http_base_from_ws


def _fill_table(table: QTableWidget, columns: list[str], rows: list[dict]) -> None:
    table.clear()
    table.setColumnCount(len(columns))
    table.setHorizontalHeaderLabels(columns)
    table.setRowCount(len(rows))
    for r_idx, row in enumerate(rows):
        for c_idx, col in enumerate(columns):
            val = row.get(col, "")
            item = QTableWidgetItem("" if val is None else str(val))
            item.setFlags(item.flags() & ~Qt.ItemFlag.ItemIsEditable)
            table.setItem(r_idx, c_idx, item)
    table.resizeColumnsToContents()


class DebugPanel(QWidget):
    def __init__(
        self,
        *,
        gateway_url_getter: Callable[[], str],
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._gateway_url_getter = gateway_url_getter

        self.rem_meta = QLabel("Reminders: —")
        self.rem_meta.setObjectName("sectionMeta")
        self.rem_table = QTableWidget(0, 4)
        self.rem_table.setHorizontalHeaderLabels(["status", "fire_at_local", "text", "id"])

        self.plan_meta = QLabel("Plans: —")
        self.plan_meta.setObjectName("sectionMeta")
        self.plan_table = QTableWidget(0, 5)
        self.plan_table.setHorizontalHeaderLabels(
            ["date", "status", "scheduled_at_local", "text", "id"]
        )

        self.theme_meta = QLabel("Themes: —")
        self.theme_meta.setObjectName("sectionMeta")
        self.theme_table = QTableWidget(0, 5)
        self.theme_table.setHorizontalHeaderLabels(
            ["kind", "status", "title", "entry_text", "id"]
        )

        refresh_btn = QPushButton("Refresh debug")
        refresh_btn.clicked.connect(self.refresh)

        top = QHBoxLayout()
        top.addWidget(refresh_btn)
        top.addStretch(1)

        layout = QVBoxLayout(self)
        layout.addLayout(top)
        layout.addWidget(self.rem_meta)
        layout.addWidget(self.rem_table, stretch=1)
        layout.addWidget(self.plan_meta)
        layout.addWidget(self.plan_table, stretch=1)
        layout.addWidget(self.theme_meta)
        layout.addWidget(self.theme_table, stretch=1)

    def refresh(self) -> None:
        base = http_base_from_ws(self._gateway_url_getter())
        try:
            with httpx.Client(timeout=5.0) as client:
                r = client.get(f"{base}/debug/reminders")
                j = r.json()
                rows = j.get("reminders") or []
                self.rem_meta.setText(f"Reminders: {len(rows)}")
                _fill_table(
                    self.rem_table,
                    ["status", "fire_at_local", "text", "id"],
                    rows,
                )

                r = client.get(f"{base}/debug/plans")
                j = r.json()
                rows = j.get("items") or []
                self.plan_meta.setText(f"Plans: {len(rows)}")
                _fill_table(
                    self.plan_table,
                    ["date", "status", "scheduled_at_local", "text", "id"],
                    rows,
                )

                r = client.get(f"{base}/debug/themes")
                j = r.json()
                rows = j.get("rows") or []
                self.theme_meta.setText(f"Themes: {len(rows)}")
                _fill_table(
                    self.theme_table,
                    ["kind", "status", "title", "entry_text", "id"],
                    rows,
                )
        except Exception as err:  # noqa: BLE001
            self.rem_meta.setText(f"debug error: {err}")
