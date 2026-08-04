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

