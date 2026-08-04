"""Current weather for the holographic orb satellite.

Fetched from Core ``GET /weather/current`` (Open-Meteo runs on the server).
Falls back to a local stub if the gateway is unreachable or unauthorized.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx

from jarvis_client.http_util import bearer_headers, http_base_from_ws

log = logging.getLogger(__name__)

DEFAULT_TIMEOUT_S = 5.0


@dataclass(frozen=True)
class WeatherSnapshot:
    """UI-ready current conditions."""

    temp_c: float
    icon: str
    label: str
    place: str = ""

    @property
    def temp_label(self) -> str:
        rounded = int(round(self.temp_c))
        sign = "+" if rounded > 0 else ""
        return f"{sign}{rounded}°"

    def to_payload(self) -> dict[str, Any]:
        return {
            "tempC": self.temp_c,
            "tempLabel": self.temp_label,
            "icon": self.icon,
            "label": self.label,
            "place": self.place,
        }

    @classmethod
    def from_payload(cls, data: dict[str, Any]) -> WeatherSnapshot:
        temp = float(data.get("tempC", 12.0))
        return cls(
            temp_c=temp,
            icon=str(data.get("icon") or ""),
            label=str(data.get("label") or "partly cloudy"),
            place=str(data.get("place") or ""),
        )


STUB_WEATHER = WeatherSnapshot(
    temp_c=12.0,
    icon="",
    label="partly cloudy",
    place="stub",
)


def current_weather(
    *,
    gateway_url: str,
    token: str,
    client: httpx.Client | None = None,
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> WeatherSnapshot:
    """Return conditions from Core. Falls back to stub on failure."""
    base = http_base_from_ws(gateway_url)
    headers = bearer_headers(token)
    if not headers:
        log.warning("Weather fetch skipped: missing gateway token; using stub")
        return STUB_WEATHER

    own_client = client is None
    http = client or httpx.Client(timeout=timeout_s)
    try:
        r = http.get(f"{base}/weather/current", headers=headers)
        if r.status_code == 401:
            raise ValueError("Unauthorized (check JARVIS_GATEWAY_TOKEN)")
        r.raise_for_status()
        body = r.json() or {}
        if not body.get("ok"):
            raise ValueError(body.get("error") or "weather response not ok")
        weather = body.get("weather")
        if not isinstance(weather, dict):
            raise ValueError("weather payload missing")
        return WeatherSnapshot.from_payload(weather)
    except Exception as exc:
        log.warning("Weather fetch failed (%s); using stub", exc)
        return STUB_WEATHER
    finally:
        if own_client:
            http.close()
