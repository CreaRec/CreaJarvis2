import { labelForWeatherCode } from "./labels.js";
import {
  STUB_WEATHER,
  type WeatherSnapshot,
  weatherSnapshot,
} from "./types.js";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const CACHE_TTL_MS = 60 * 60 * 1000;

export type WeatherServiceConfig = {
  enabled: boolean;
  lat?: number;
  lon?: number;
  place: string;
  timeoutMs: number;
};

type FetchLike = typeof fetch;

type ForecastResponse = {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
    is_day?: number;
  };
};

type GeocodeResponse = {
  results?: Array<{
    name?: string;
    latitude?: number;
    longitude?: number;
    admin1?: string;
    country?: string;
  }>;
};

export function weatherEnabledFlag(raw: string | undefined): boolean {
  const v = (raw ?? "1").trim().toLowerCase();
  return !["0", "false", "no", "stub", "off"].includes(v);
}

export class OpenMeteoWeather {
  private cache: { snap: WeatherSnapshot; at: number } | null = null;

  constructor(
    private readonly cfg: WeatherServiceConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  clearCache(): void {
    this.cache = null;
  }

  async current(): Promise<WeatherSnapshot> {
    if (!this.cfg.enabled) return STUB_WEATHER;

    const now = Date.now();
    if (this.cache && now - this.cache.at < CACHE_TTL_MS) {
      return this.cache.snap;
    }

    try {
      const loc = await this.resolveLocation();
      const snap = await this.fetchForecast(loc);
      this.cache = { snap, at: now };
      return snap;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[weather] fetch failed (${message}); using stub`);
      return this.cache?.snap ?? STUB_WEATHER;
    }
  }

  private async resolveLocation(): Promise<{
    lat: number;
    lon: number;
    place: string;
  }> {
    const { lat, lon, place } = this.cfg;
    if (lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)) {
      return { lat, lon, place };
    }
    if (place.trim()) {
      return this.geocodePlace(place.trim());
    }
    throw new Error(
      "Weather location unset — set JARVIS_WEATHER_LAT/LON or JARVIS_WEATHER_PLACE",
    );
  }

  private async geocodePlace(
    name: string,
  ): Promise<{ lat: number; lon: number; place: string }> {
    const params = new URLSearchParams({
      name,
      count: "1",
      language: "en",
      format: "json",
    });
    const data = await this.getJson<GeocodeResponse>(
      `${GEOCODE_URL}?${params.toString()}`,
    );
    const hit = data.results?.[0];
    if (
      !hit ||
      hit.latitude == null ||
      hit.longitude == null ||
      !Number.isFinite(hit.latitude) ||
      !Number.isFinite(hit.longitude)
    ) {
      throw new Error(`No geocoding results for ${JSON.stringify(name)}`);
    }
    const parts = [hit.name || name, hit.admin1, hit.country].filter(
      (p): p is string => Boolean(p && String(p).trim()),
    );
    return {
      lat: hit.latitude,
      lon: hit.longitude,
      place: parts.join(", "),
    };
  }

  private async fetchForecast(loc: {
    lat: number;
    lon: number;
    place: string;
  }): Promise<WeatherSnapshot> {
    const params = new URLSearchParams({
      latitude: String(loc.lat),
      longitude: String(loc.lon),
      current: "temperature_2m,weather_code,is_day",
      timezone: "auto",
    });
    const data = await this.getJson<ForecastResponse>(
      `${FORECAST_URL}?${params.toString()}`,
    );
    const current = data.current;
    if (current?.temperature_2m == null) {
      throw new Error("Open-Meteo response missing temperature_2m");
    }
    const code = Math.trunc(current.weather_code ?? 0);
    return weatherSnapshot({
      tempC: current.temperature_2m,
      icon: String(code),
      label: labelForWeatherCode(code),
      place: loc.place,
    });
  }

  private async getJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `Open-Meteo HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
        );
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error("Open-Meteo request timed out");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
