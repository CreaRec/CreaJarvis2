"""Stub weather snapshot for the holographic orb satellite.

Replace ``current_weather`` later with a real provider; the orb bridge
expects ``WeatherSnapshot.to_payload()``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


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


# Placeholder until a live weather source is wired up.
STUB_WEATHER = WeatherSnapshot(
    temp_c=12.0,
    icon="☁",
    label="partly cloudy",
    place="stub",
)


def current_weather() -> WeatherSnapshot:
    """Return conditions for the orb. Stub for now."""
    return STUB_WEATHER
