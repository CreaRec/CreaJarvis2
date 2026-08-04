import { afterEach, describe, expect, it, vi } from "vitest";
import { GooglePlacesClient } from "./google-places-client.js";

describe("GooglePlacesClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("maps searchText results to PlaceHit", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        places: [
          {
            id: "places/abc",
            displayName: { text: "Starbucks" },
            formattedAddress: "123 Lamar Blvd, Austin, TX",
            location: { latitude: 30.27, longitude: -97.74 },
            googleMapsUri: "https://maps.google.com/?cid=1",
            types: ["cafe", "coffee_shop"],
            rating: 4.2,
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new GooglePlacesClient("key", "en");
    const result = await client.searchPlaces({
      query: "starbucks",
      near: "Austin TX",
      count: 5,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results).toEqual([
      {
        name: "Starbucks",
        address: "123 Lamar Blvd, Austin, TX",
        mapsUrl: "https://maps.google.com/?cid=1",
        lat: 30.27,
        lon: -97.74,
        rating: 4.2,
        categories: ["cafe", "coffee_shop"],
      },
    ]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe("POST");
    expect(init.headers["X-Goog-Api-Key"]).toBe("key");
    expect(JSON.parse(init.body as string)).toEqual({
      textQuery: "starbucks near Austin TX",
      languageCode: "en",
    });
  });

  it("returns error on non-OK HTTP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "forbidden",
      }),
    );
    const client = new GooglePlacesClient("key", "ru");
    const result = await client.searchPlaces({ query: "x", count: 3 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("403");
  });
});
