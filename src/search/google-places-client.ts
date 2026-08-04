const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
const REQUEST_TIMEOUT_MS = 8_000;
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.googleMapsUri",
  "places.types",
  "places.rating",
].join(",");

export type GooglePlacesResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface PlaceHit {
  name: string;
  address: string;
  mapsUrl: string | null;
  lat: number | null;
  lon: number | null;
  rating: number | null;
  categories: string[];
}

interface SearchTextResponse {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    googleMapsUri?: string;
    types?: string[];
    rating?: number;
  }>;
}

export class GooglePlacesClient {
  constructor(
    private readonly apiKey: string,
    private readonly languageCode: string,
  ) {}

  async searchPlaces(opts: {
    query: string;
    near?: string;
    count: number;
  }): Promise<GooglePlacesResult<{ results: PlaceHit[] }>> {
    const near = opts.near?.trim();
    const textQuery = near
      ? `${opts.query.trim()} near ${near}`
      : opts.query.trim();

    const raw = await this.postJson<SearchTextResponse>({
      textQuery,
      languageCode: this.languageCode,
    });
    if (!raw.ok) return raw;

    const results: PlaceHit[] = (raw.data.places ?? [])
      .slice(0, opts.count)
      .map((p) => {
        const lat = p.location?.latitude;
        const lon = p.location?.longitude;
        return {
          name: p.displayName?.text?.trim() ?? "",
          address: p.formattedAddress?.trim() ?? "",
          mapsUrl: p.googleMapsUri?.trim() || null,
          lat: typeof lat === "number" && Number.isFinite(lat) ? lat : null,
          lon: typeof lon === "number" && Number.isFinite(lon) ? lon : null,
          rating: typeof p.rating === "number" ? p.rating : null,
          categories: p.types ?? [],
        };
      });

    return { ok: true, data: { results } };
  }

  private async postJson<T>(
    body: Record<string, unknown>,
  ): Promise<GooglePlacesResult<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(PLACES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const snippet = text.slice(0, 200);
        return {
          ok: false,
          error: `Google Places HTTP ${res.status}${snippet ? `: ${snippet}` : ""}`,
        };
      }
      const data = (await res.json()) as T;
      return { ok: true, data };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, error: "Google Places request timed out" };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Google Places request failed: ${message}` };
    } finally {
      clearTimeout(timer);
    }
  }
}
