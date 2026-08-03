"""Tests for stub weather payload used by the orb satellite."""

from jarvis_client.weather import STUB_WEATHER, WeatherSnapshot, current_weather


def test_stub_weather_payload_shape() -> None:
    snap = current_weather()
    assert snap is STUB_WEATHER
    payload = snap.to_payload()
    assert payload["tempC"] == 12.0
    assert payload["tempLabel"] == "+12°"
    assert payload["icon"]
    assert payload["label"]
    assert payload["place"] == "stub"


def test_temp_label_signs() -> None:
    assert WeatherSnapshot(temp_c=0, icon="·", label="x").temp_label == "0°"
    assert WeatherSnapshot(temp_c=-3.4, icon="·", label="x").temp_label == "-3°"
    assert WeatherSnapshot(temp_c=21.6, icon="·", label="x").temp_label == "+22°"
