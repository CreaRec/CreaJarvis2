"""Tests for Core-backed weather client."""

from __future__ import annotations

import httpx
import pytest

from jarvis_client.weather import STUB_WEATHER, WeatherSnapshot, current_weather


def test_temp_label_signs() -> None:
    assert WeatherSnapshot(temp_c=0, icon="·", label="x").temp_label == "0°"
    assert WeatherSnapshot(temp_c=-3.4, icon="·", label="x").temp_label == "-3°"
    assert WeatherSnapshot(temp_c=21.6, icon="·", label="x").temp_label == "+22°"


def test_from_payload() -> None:
    snap = WeatherSnapshot.from_payload(
        {
            "tempC": 28.2,
            "tempLabel": "+28°",
            "icon": "0",
            "label": "clear",
            "place": "Pflugerville",
        }
    )
    assert snap.temp_c == 28.2
    assert snap.temp_label == "+28°"
    assert snap.place == "Pflugerville"


def test_stub_without_token() -> None:
    snap = current_weather(gateway_url="ws://127.0.0.1:8787/voice", token="")
    assert snap is STUB_WEATHER


def test_current_weather_from_core() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/weather/current"
        assert request.headers.get("Authorization") == "Bearer secret-token"
        return httpx.Response(
            200,
            json={
                "ok": True,
                "weather": {
                    "tempC": 28.0,
                    "tempLabel": "+28°",
                    "icon": "0",
                    "label": "clear",
                    "place": "Pflugerville",
                },
            },
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        snap = current_weather(
            gateway_url="ws://127.0.0.1:8787/voice",
            token="secret-token",
            client=client,
        )
    assert snap.temp_label == "+28°"
    assert snap.label == "clear"
    assert snap.place == "Pflugerville"


def test_current_weather_falls_back_on_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="down")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        snap = current_weather(
            gateway_url="ws://127.0.0.1:8787/voice",
            token="secret-token",
            client=client,
        )
    assert snap is STUB_WEATHER


def test_current_weather_unauthorized() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"ok": False, "error": "Unauthorized"})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        snap = current_weather(
            gateway_url="ws://127.0.0.1:8787/voice",
            token="bad",
            client=client,
        )
    assert snap is STUB_WEATHER
