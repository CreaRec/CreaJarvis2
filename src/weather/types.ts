export interface WeatherSnapshot {
  tempC: number;
  tempLabel: string;
  icon: string;
  label: string;
  place: string;
}

export const STUB_WEATHER: WeatherSnapshot = {
  tempC: 12,
  tempLabel: "+12°",
  icon: "",
  label: "partly cloudy",
  place: "stub",
};

export function formatTempLabel(tempC: number): string {
  const rounded = Math.round(tempC);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}°`;
}

export function weatherSnapshot(input: {
  tempC: number;
  icon: string;
  label: string;
  place?: string;
}): WeatherSnapshot {
  return {
    tempC: input.tempC,
    tempLabel: formatTempLabel(input.tempC),
    icon: input.icon,
    label: input.label,
    place: input.place ?? "",
  };
}
