"""HTTP helpers shared by the desktop UI."""

from __future__ import annotations

from urllib.parse import urlparse


def http_base_from_ws(ws_url: str) -> str:
    try:
        u = urlparse(ws_url)
        proto = "https" if u.scheme == "wss" else "http"
        return f"{proto}://{u.hostname}:{u.port or (443 if proto == 'https' else 80)}"
    except Exception:
        return "http://127.0.0.1:8787"


def bearer_headers(token: str) -> dict[str, str]:
    t = (token or "").strip()
    if not t:
        return {}
    return {"Authorization": f"Bearer {t}"}
