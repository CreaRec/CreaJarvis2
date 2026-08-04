import { afterEach, describe, expect, it, vi } from "vitest";
import { labelForWeatherCode } from "./labels.js";
import { OpenMeteoWeather, weatherEnabledFlag } from "./open-meteo.js";
import { formatTempLabel, STUB_WEATHER } from "./types.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("labelForWeatherCode", () => {
  it("maps known WMO codes", () => {
    expect(labelForWeatherCode(0)).toBe("clear");
    expect(labelForWeatherCode(2)).toBe("partly cloudy");
    expect(labelForWeatherCode(61)).toBe("slight rain");
    expect(labelForWeatherCode(73)).toBe("snow");
    expect(labelForWeatherCode(999)).toBe("cloudy");
  });
});

describe("formatTempLabel", () => {
  it("formats signs", () => {
    expect(formatTempLabel(0)).toBe("0°");
    expect(formatTempLabel(-3.4)).toBe("-3°");
    expect(formatTempLabel(21.6)).toBe("+22°");
  });
});

describe("weatherEnabledFlag", () => {
  it("disables stub flags", () => {
    expect(weatherEnabledFlag("1")).toBe(true);
    expect(weatherEnabledFlag("0")).toBe(false);
    expect(weatherEnabledFlag("stub")).toBe(false);
    expect(weatherEnabledFlag("off")).toBe(false);
  });
});

describe("OpenMeteoWeather", () => {
  it("returns stub when disabled", async () => {
    const weather = new OpenMeteoWeather({
      enabled: false,
      place: "",
      timeoutMs: 1000,
    });
    await expect(weather.current()).resolves.toEqual(STUB_WEATHER);
  });

  it("fetches forecast for configured coords", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      expect(href).toContain("api.open-meteo.com");
      return new Response(
        JSON.stringify({
          current: {
            temperature_2m: 28.2,
            weather_code: 0,
            is_day: 1,
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const weather = new OpenMeteoWeather(
      {
        enabled: true,
        lat: 30.4234,
        lon: -97.6115,
        place: "Pflugerville",
        timeoutMs: 2000,
      },
      fetchMock as unknown as typeof fetch,
    );

    const snap = await weather.current();
    expect(snap).toEqual({
      tempC: 28.2,
      tempLabel: "+28°",
      icon: "0",
      label: "clear",
      place: "Pflugerville",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Cached — no second network call.
    await weather.current();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("geocodes place when coords missing", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("geocoding-api")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                name: "Berlin",
                latitude: 52.52,
                longitude: 13.41,
                admin1: "Berlin",
                country: "Germany",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          current: { temperature_2m: 10, weather_code: 61 },
        }),
        { status: 200 },
      );
    });

    const weather = new OpenMeteoWeather(
      {
        enabled: true,
        place: "Berlin",
        timeoutMs: 2000,
      },
      fetchMock as unknown as typeof fetch,
    );

    const snap = await weather.current();
    expect(snap.tempLabel).toBe("+10°");
    expect(snap.label).toBe("slight rain");
    expect(snap.place).toBe("Berlin, Berlin, Germany");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to stub when location unset", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const weather = new OpenMeteoWeather({
      enabled: true,
      place: "",
      timeoutMs: 1000,
    });
    await expect(weather.current()).resolves.toEqual(STUB_WEATHER);
    expect(warn).toHaveBeenCalled();
  });

  it("falls back to stub on HTTP error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(
      async () => new Response("down", { status: 503 }),
    );
    const weather = new OpenMeteoWeather(
      {
        enabled: true,
        lat: 1,
        lon: 2,
        place: "x",
        timeoutMs: 1000,
      },
      fetchMock as unknown as typeof fetch,
    );
    await expect(weather.current()).resolves.toEqual(STUB_WEATHER);
    expect(warn).toHaveBeenCalled();
  });
});
