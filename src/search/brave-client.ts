const BRAVE_BASE = "https://api.search.brave.com/res/v1";
const REQUEST_TIMEOUT_MS = 8_000;

export type BraveClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface WebHit {
  title: string;
  url: string;
  snippet: string;
}

export interface PlaceHit {
  name: string;
  address: string;
  rating: number | null;
  hours: string | null;
  distance: string | null;
  categories: string[];
  phone?: string;
  url?: string;
}

export class BraveClient {
  constructor(
    private readonly apiKey: string,
    private readonly country: string,
    private readonly searchLang: string,
  ) {}

  async searchWeb(opts: {
    query: string;
    count: number;
  }): Promise<BraveClientResult<{ results: WebHit[] }>> {
    const params = new URLSearchParams({
      q: opts.query,
      count: String(opts.count),
      country: this.country,
      search_lang: this.searchLang,
    });

    const raw = await this.getJson<BraveWebResponse>(
      `/web/search?${params.toString()}`,
    );
    if (!raw.ok) return raw;

    const results: WebHit[] = (raw.data.web?.results ?? [])
      .slice(0, opts.count)
      .map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.description ?? "",
      }));

    return { ok: true, data: { results } };
  }

  async searchPlaces(opts: {
    query: string;
    near?: string;
    count: number;
  }): Promise<BraveClientResult<{ results: PlaceHit[] }>> {
    const params = new URLSearchParams({
      q: opts.query,
      count: String(opts.count),
      country: this.country,
      search_lang: this.searchLang,
    });
    if (opts.near?.trim()) {
      params.set("location", opts.near.trim());
    }

    const raw = await this.getJson<BravePlaceResponse>(
      `/local/place_search?${params.toString()}`,
    );
    if (!raw.ok) return raw;

    const results: PlaceHit[] = (raw.data.results ?? [])
      .slice(0, opts.count)
      .map((r) => {
        const hours = formatHours(r.opening_hours);
        const distance =
          r.distance?.value != null && r.distance.units
            ? `${r.distance.value} ${r.distance.units}`
            : null;
        const hit: PlaceHit = {
          name: r.title ?? "",
          address: r.postal_address?.displayAddress ?? "",
          rating: r.rating?.ratingValue ?? null,
          hours,
          distance,
          categories: r.categories ?? [],
        };
        if (r.contact?.telephone) hit.phone = r.contact.telephone;
        if (r.url) hit.url = r.url;
        return hit;
      });

    return { ok: true, data: { results } };
  }

  private async getJson<T>(path: string): Promise<BraveClientResult<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${BRAVE_BASE}${path}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": this.apiKey,
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const snippet = body.slice(0, 200);
        return {
          ok: false,
          error: `Brave HTTP ${res.status}${snippet ? `: ${snippet}` : ""}`,
        };
      }
      const data = (await res.json()) as T;
      return { ok: true, data };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, error: "Brave request timed out" };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Brave request failed: ${message}` };
    } finally {
      clearTimeout(timer);
    }
  }
}

interface BraveWebResponse {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
    }>;
  };
}

interface BravePlaceResponse {
  results?: Array<{
    title?: string;
    url?: string;
    postal_address?: { displayAddress?: string };
    rating?: { ratingValue?: number };
    opening_hours?: {
      current_day?: Array<{
        abbr_name?: string;
        opens?: string;
        closes?: string;
      }>;
    };
    distance?: { value?: number; units?: string };
    categories?: string[];
    contact?: { telephone?: string };
  }>;
}

function formatHours(opening?: {
  current_day?: Array<{
    abbr_name?: string;
    opens?: string;
    closes?: string;
  }>;
}): string | null {
  const day = opening?.current_day?.[0];
  if (!day?.opens || !day?.closes) return null;
  const label = day.abbr_name ? `${day.abbr_name} ` : "";
  return `${label}${day.opens}–${day.closes}`;
}
