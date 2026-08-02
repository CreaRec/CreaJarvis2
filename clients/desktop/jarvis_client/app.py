"""NiceGUI desktop shell for CreaJarvis voice client."""

from __future__ import annotations

import asyncio
import os
from datetime import datetime
from urllib.parse import urlparse

import httpx
from nicegui import app, ui

from jarvis_client.session import SessionController

DEFAULT_WS = os.environ.get("VOICE_GATEWAY_URL", "ws://127.0.0.1:8787/voice")


def http_base_from_ws(ws_url: str) -> str:
    try:
        u = urlparse(ws_url)
        proto = "https" if u.scheme == "wss" else "http"
        return f"{proto}://{u.hostname}:{u.port or (443 if proto == 'https' else 80)}"
    except Exception:
        return "http://127.0.0.1:8787"


def build_ui() -> None:
    controller_holder: dict[str, SessionController | None] = {"c": None}
    log_box: ui.log
    status_label: ui.label
    state_label: ui.label
    ws_input: ui.input

    def append_log(msg: str) -> None:
        stamp = datetime.now().strftime("%H:%M:%S")
        log_box.push(f"[{stamp}] {msg}")

    def set_state(s: str) -> None:
        state_label.set_text(f"FSM: {s}")

    def show_toast(title: str, body: str, meta: str) -> None:
        with ui.dialog() as dlg, ui.card().classes("w-96"):
            ui.label(title).classes("text-h6")
            ui.label(body).classes("whitespace-pre-wrap")
            if meta:
                ui.label(meta).classes("text-caption")
            ui.button("OK", on_click=dlg.close)
        dlg.open()
        ui.notify(f"{title}: {body[:80]}", type="info", position="bottom")

    ui.page_title("CreaJarvis Desktop")

    with ui.header().classes("items-center justify-between"):
        ui.label("CreaJarvis").classes("text-h5")
        status_label = ui.label("disconnected").classes("text-caption")
        state_label = ui.label("FSM: idle").classes("text-caption")

    with ui.row().classes("w-full items-end gap-2"):
        ws_input = ui.input("Voice Gateway WS", value=DEFAULT_WS).classes("flex-grow")
        ui.button("Connect", on_click=lambda: do_connect()).props("color=primary")
        ui.button("Disconnect", on_click=lambda: do_disconnect())

    with ui.row().classes("gap-2"):
        ui.button("Wake (Space)", on_click=lambda: do_wake()).props("color=secondary")
        ui.label("Say «Джарвис» when microWakeWord model is loaded, or press Wake.").classes(
            "text-caption"
        )

    with ui.row().classes("w-full items-end gap-2"):
        text_in = ui.input("Text message").classes("flex-grow")

        def send_text() -> None:
            c = controller_holder["c"]
            if c:
                c.send_text(text_in.value or "")
                text_in.set_value("")

        ui.button("Send", on_click=send_text)

    log_box = ui.log(max_lines=500).classes("w-full h-64")

    # --- Debug panels ---
    rem_meta = ui.label("Reminders: —")
    rem_table = ui.aggrid(
        {
            "columnDefs": [
                {"field": "status"},
                {"field": "fire_at_local"},
                {"field": "text"},
                {"field": "id"},
            ],
            "rowData": [],
        }
    ).classes("w-full h-48")

    plan_meta = ui.label("Plans: —")
    plan_table = ui.aggrid(
        {
            "columnDefs": [
                {"field": "date"},
                {"field": "status"},
                {"field": "scheduled_at_local"},
                {"field": "text"},
                {"field": "id"},
            ],
            "rowData": [],
        }
    ).classes("w-full h-48")

    theme_meta = ui.label("Themes: —")
    theme_table = ui.aggrid(
        {
            "columnDefs": [
                {"field": "kind"},
                {"field": "status"},
                {"field": "title"},
                {"field": "entry_text"},
                {"field": "id"},
            ],
            "rowData": [],
        }
    ).classes("w-full h-48")

    async def refresh_debug() -> None:
        base = http_base_from_ws(ws_input.value or DEFAULT_WS)
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{base}/debug/reminders")
                j = r.json()
                rows = j.get("reminders") or []
                rem_meta.set_text(f"Reminders: {len(rows)}")
                rem_table.options["rowData"] = rows
                rem_table.update()

                r = await client.get(f"{base}/debug/plans")
                j = r.json()
                rows = j.get("items") or []
                plan_meta.set_text(f"Plans: {len(rows)}")
                plan_table.options["rowData"] = rows
                plan_table.update()

                r = await client.get(f"{base}/debug/themes")
                j = r.json()
                rows = j.get("rows") or []
                theme_meta.set_text(f"Themes: {len(rows)}")
                theme_table.options["rowData"] = rows
                theme_table.update()
        except Exception as err:  # noqa: BLE001
            rem_meta.set_text(f"debug error: {err}")

    ui.button("Refresh debug", on_click=lambda: asyncio.create_task(refresh_debug()))

    def do_connect() -> None:
        do_disconnect()
        url = (ws_input.value or DEFAULT_WS).strip()
        c = SessionController(
            gateway_url=url,
            on_log=append_log,
            on_state=set_state,
            on_toast=show_toast,
            loop=asyncio.get_event_loop(),
        )
        c.bind_loop(asyncio.get_event_loop())
        controller_holder["c"] = c
        try:
            c.connect_transport()
            status_label.set_text("connected")
        except Exception as err:  # noqa: BLE001
            append_log(f"connect failed: {err}")
            status_label.set_text("error")

    def do_disconnect() -> None:
        c = controller_holder["c"]
        if c:
            c.disconnect_transport()
            controller_holder["c"] = None
        status_label.set_text("disconnected")
        set_state("idle")

    def do_wake() -> None:
        c = controller_holder["c"]
        if not c:
            append_log("connect first")
            return
        c.trigger_wake()

    def on_key(e) -> None:  # noqa: ANN001
        if e.action.keydown and e.key.name == " ":
            do_wake()

    ui.keyboard(on_key=on_key)

    @app.on_shutdown
    def _shutdown() -> None:
        do_disconnect()


def main() -> None:
    build_ui()
    ui.run(
        title="CreaJarvis Desktop",
        host=os.environ.get("JARVIS_UI_HOST", "127.0.0.1"),
        port=int(os.environ.get("JARVIS_UI_PORT", "5173")),
        reload=False,
        show=True,
    )


if __name__ in {"__main__", "__mp_main__"}:
    main()
