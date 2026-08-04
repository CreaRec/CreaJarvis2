"""Current weather for the holographic orb satellite.

Uses Open-Meteo (no API key). Configure with ``JARVIS_WEATHER_LAT`` /
``JARVIS_WEATHER_LON`` and optional ``JARVIS_WEATHER_PLACE``, or only
``JARVIS_WEATHER_PLACE`` to geocode. With neither set, location is inferred
from public IP. Set ``JARVIS_WEATHER=0`` (or ``stub``) to force the stub.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from typing import Any

import httpx

log = logging.getLogger(__name__)

OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_GEOCODE = "https://geocoding-api.open-meteo.com/v1/search"
IP_GEO_URL = "https://ipapi.co/json/"

DEFAULT_TIMEOUT_S = 3.0
# Soft cache for duplicate callers; MainWindow clears this on the hourly refresh.
CACHE_TTL_S = 60 * 60

# WMO weather interpretation codes → English labels the orb badge understands
# (rain / drizzle / snow / clear / cloudy keywords in orb.js).
_WMO_LABELS: dict[int, str] = {
    0: "clear",
    1: "mainly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "fog",
    48: "fog",
    51: "light drizzle",
    53: "drizzle",
    55: "dense drizzle",
    56: "freezing drizzle",
    57: "freezing drizzle",
    61: "slight rain",
    63: "rain",
    65: "heavy rain",
    66: "freezing rain",
    67: "freezing rain",
    71: "slight snow",
    73: "snow",
    75: "heavy snow",
    77: "snow grains",
    80: "rain showers",
    81: "rain showers",
    82: "violent rain showers",
    85: "snow showers",
    86: "heavy snow showers",
    95: "thunderstorm",
    96: "thunderstorm",
    99: "thunderstorm",
}


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


STUB_WEATHER = WeatherSnapshot(
    temp_c=12.0,
    icon="",
    label="partly cloudy",
    place="stub",
)

_cache: WeatherSnapshot | None = None
_cache_at: float = 0.0


def label_for_weather_code(code: int) -> str:
    return _WMO_LABELS.get(int(code), "cloudy")


def _env_flag_disabled() -> bool:
    raw = os.environ.get("JARVIS_WEATHER", "1").strip().lower()
    return raw in {"0", "false", "no", "stub", "off"}


def _timeout_s() -> float:
    raw = os.environ.get("JARVIS_WEATHER_TIMEOUT", "").strip()
    if not raw:
        return DEFAULT_TIMEOUT_S
    try:
        return max(0.5, float(raw))
    except ValueError:
        return DEFAULT_TIMEOUT_S


def _parse_coord(name: str) -> float | None:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        log.warning("Invalid %s=%r", name, raw)
        return None


def resolve_location(client: httpx.Client) -> tuple[float, float, str]:
    """Return ``(lat, lon, place)`` from env, geocoding, or IP."""
    lat = _parse_coord("JARVIS_WEATHER_LAT")
    lon = _parse_coord("JARVIS_WEATHER_LON")
    place = os.environ.get("JARVIS_WEATHER_PLACE", "").strip()

    if lat is not None and lon is not None:
        return lat, lon, place

    if place:
        lat, lon, resolved = _geocode_place(client, place)
        return lat, lon, resolved or place

    return _location_from_ip(client)


def _geocode_place(client: httpx.Client, name: str) -> tuple[float, float, str]:
    r = client.get(
        OPEN_METEO_GEOCODE,
        params={"name": name, "count": 1, "language": "en", "format": "json"},
    )
    r.raise_for_status()
    results = (r.json() or {}).get("results") or []
    if not results:
        raise ValueError(f"No geocoding results for {name!r}")
    hit = results[0]
    label_parts = [hit.get("name") or name]
    admin = hit.get("admin1") or ""
    country = hit.get("country") or ""
    if admin:
        label_parts.append(admin)
    if country:
        label_parts.append(country)
    return float(hit["latitude"]), float(hit["longitude"]), ", ".join(label_parts)


def _location_from_ip(client: httpx.Client) -> tuple[float, float, str]:
    r = client.get(IP_GEO_URL)
    r.raise_for_status()
    data = r.json() or {}
    if data.get("error"):
        raise ValueError(data.get("reason") or "IP geolocation failed")
    lat = data.get("latitude")
    lon = data.get("longitude")
    if lat is None or lon is None:
        raise ValueError("IP geolocation missing coordinates")
    city = (data.get("city") or "").strip()
    region = (data.get("region") or "").strip()
    country = (data.get("country_name") or data.get("country") or "").strip()
    parts = [p for p in (city, region, country) if p]
    return float(lat), float(lon), ", ".join(parts)


def fetch_open_meteo(
    lat: float,
    lon: float,
    place: str = "",
    *,
    client: httpx.Client | None = None,
) -> WeatherSnapshot:
    """Fetch current conditions from Open-Meteo."""
    own_client = client is None
    http = client or httpx.Client(timeout=_timeout_s())
    try:
        r = http.get(
            OPEN_METEO_FORECAST,
            params={
                "latitude": lat,
                "longitude": lon,
                "current": "temperature_2m,weather_code,is_day",
                "timezone": "auto",
            },
        )
        r.raise_for_status()
        body = r.json() or {}
        current = body.get("current") or {}
        if "temperature_2m" not in current:
            raise ValueError("Open-Meteo response missing temperature_2m")
        code = int(current.get("weather_code") or 0)
        label = label_for_weather_code(code)
        return WeatherSnapshot(
            temp_c=float(current["temperature_2m"]),
            icon=str(code),
            label=label,
            place=place,
        )
    finally:
        if own_client:
            http.close()


def current_weather(*, client: httpx.Client | None = None) -> WeatherSnapshot:
    """Return conditions for the orb. Falls back to stub on failure."""
    global _cache, _cache_at

    if _env_flag_disabled():
        return STUB_WEATHER

    now = time.monotonic()
    if _cache is not None and (now - _cache_at) < CACHE_TTL_S:
        return _cache

    own_client = client is None
    http = client or httpx.Client(timeout=_timeout_s())
    try:
        lat, lon, place = resolve_location(http)
        snap = fetch_open_meteo(lat, lon, place, client=http)
        _cache = snap
        _cache_at = now
        return snap
    except Exception as exc:
        log.warning("Weather fetch failed (%s); using stub", exc)
        return _cache if _cache is not None else STUB_WEATHER
    finally:
        if own_client:
            http.close()


def clear_weather_cache() -> None:
    """Drop cached snapshot (for tests)."""
    global _cache, _cache_at
    _cache = None
    _cache_at = 0.0
