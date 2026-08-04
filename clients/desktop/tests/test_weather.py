"""Tests for Open-Meteo weather + stub fallback."""

from __future__ import annotations

import httpx
import pytest

from jarvis_client import weather as weather_mod
from jarvis_client.weather import (
    STUB_WEATHER,
    WeatherSnapshot,
    clear_weather_cache,
    current_weather,
    fetch_open_meteo,
    label_for_weather_code,
    resolve_location,
)


@pytest.fixture(autouse=True)
def _reset_weather_cache() -> None:
    clear_weather_cache()
    yield
    clear_weather_cache()


def test_temp_label_signs() -> None:
    assert WeatherSnapshot(temp_c=0, icon="·", label="x").temp_label == "0°"
    assert WeatherSnapshot(temp_c=-3.4, icon="·", label="x").temp_label == "-3°"
    assert WeatherSnapshot(temp_c=21.6, icon="·", label="x").temp_label == "+22°"


def test_stub_when_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JARVIS_WEATHER", "0")
    snap = current_weather()
    assert snap is STUB_WEATHER
    payload = snap.to_payload()
    assert payload["tempC"] == 12.0
    assert payload["tempLabel"] == "+12°"
    assert payload["place"] == "stub"


def test_label_for_weather_code() -> None:
    assert label_for_weather_code(0) == "clear"
    assert label_for_weather_code(2) == "partly cloudy"
    assert label_for_weather_code(61) == "slight rain"
    assert label_for_weather_code(73) == "snow"
    assert label_for_weather_code(999) == "cloudy"


def test_resolve_location_from_coords(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JARVIS_WEATHER_LAT", "55.75")
    monkeypatch.setenv("JARVIS_WEATHER_LON", "37.62")
    monkeypatch.setenv("JARVIS_WEATHER_PLACE", "Moscow")
    transport = httpx.MockTransport(lambda request: httpx.Response(500))
    with httpx.Client(transport=transport) as client:
        lat, lon, place = resolve_location(client)
    assert lat == 55.75
    assert lon == 37.62
    assert place == "Moscow"


def test_resolve_location_geocode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("JARVIS_WEATHER_LAT", raising=False)
    monkeypatch.delenv("JARVIS_WEATHER_LON", raising=False)
    monkeypatch.setenv("JARVIS_WEATHER_PLACE", "Berlin")

    def handler(request: httpx.Request) -> httpx.Response:
        assert "geocoding-api.open-meteo.com" in str(request.url)
        return httpx.Response(
            200,
            json={
                "results": [
                    {
                        "name": "Berlin",
                        "latitude": 52.52,
                        "longitude": 13.41,
                        "admin1": "Berlin",
                        "country": "Germany",
                    }
                ]
            },
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        lat, lon, place = resolve_location(client)
    assert lat == 52.52
    assert lon == 13.41
    assert place == "Berlin, Berlin, Germany"


def test_resolve_location_from_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("JARVIS_WEATHER_LAT", raising=False)
    monkeypatch.delenv("JARVIS_WEATHER_LON", raising=False)
    monkeypatch.delenv("JARVIS_WEATHER_PLACE", raising=False)

    def handler(request: httpx.Request) -> httpx.Response:
        assert "ipapi.co" in str(request.url)
        return httpx.Response(
            200,
            json={
                "latitude": 40.71,
                "longitude": -74.01,
                "city": "New York",
                "region": "New York",
                "country_name": "United States",
            },
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        lat, lon, place = resolve_location(client)
    assert lat == 40.71
    assert lon == -74.01
    assert place == "New York, New York, United States"


def test_fetch_open_meteo() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert "api.open-meteo.com" in str(request.url)
        return httpx.Response(
            200,
            json={
                "current": {
                    "temperature_2m": 18.4,
                    "weather_code": 61,
                    "is_day": 1,
                }
            },
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        snap = fetch_open_meteo(55.0, 37.0, "Moscow", client=client)
    assert snap.temp_c == 18.4
    assert snap.temp_label == "+18°"
    assert snap.label == "slight rain"
    assert snap.icon == "61"
    assert snap.place == "Moscow"


def test_current_weather_live(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JARVIS_WEATHER", "1")
    monkeypatch.setenv("JARVIS_WEATHER_LAT", "55.75")
    monkeypatch.setenv("JARVIS_WEATHER_LON", "37.62")
    monkeypatch.setenv("JARVIS_WEATHER_PLACE", "Moscow")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "current": {
                    "temperature_2m": -2.2,
                    "weather_code": 71,
                    "is_day": 0,
                }
            },
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        snap = current_weather(client=client)
    assert snap.temp_label == "-2°"
    assert snap.label == "slight snow"
    assert snap.place == "Moscow"


def test_current_weather_falls_back_on_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("JARVIS_WEATHER", "1")
    monkeypatch.setenv("JARVIS_WEATHER_LAT", "1")
    monkeypatch.setenv("JARVIS_WEATHER_LON", "2")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="down")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        snap = current_weather(client=client)
    assert snap is STUB_WEATHER


def test_current_weather_uses_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JARVIS_WEATHER", "1")
    monkeypatch.setenv("JARVIS_WEATHER_LAT", "10")
    monkeypatch.setenv("JARVIS_WEATHER_LON", "20")
    monkeypatch.setenv("JARVIS_WEATHER_PLACE", "CacheTown")
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(
            200,
            json={"current": {"temperature_2m": 5.0, "weather_code": 0}},
        )

    transport = httpx.MockTransport(handler)
    with httpx.Client(transport=transport) as client:
        a = current_weather(client=client)
        b = current_weather(client=client)
    assert a.temp_c == 5.0
    assert b is a
    assert calls["n"] == 1
    # Sanity: module cache still holds across client close.
    assert weather_mod._cache is a
