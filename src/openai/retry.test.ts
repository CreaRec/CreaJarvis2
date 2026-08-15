import { describe, expect, it, vi } from "vitest";
import { logger } from "../log.js";
import {
  OPENAI_RETRY_BUFFER_MS,
  OPENAI_RETRY_MAX_ATTEMPTS,
  OPENAI_RETRY_MAX_WAIT_MS,
  openaiPostJson,
  openAiRetryWaitMs,
  parseOpenAiDurationMs,
  parseOpenAiRetryHintMs,
} from "./retry.js";

describe("OpenAI retry delay parsing", () => {
  it("parses OpenAI duration strings", () => {
    expect(parseOpenAiDurationMs("8.294s")).toBe(8294);
    expect(parseOpenAiDurationMs("1m30s")).toBe(90_000);
    expect(parseOpenAiDurationMs("6m0s")).toBe(360_000);
    expect(parseOpenAiDurationMs("not-a-duration")).toBeNull();
  });

  it("prefers Retry-After seconds, then reset header, then body text", () => {
    expect(
      parseOpenAiRetryHintMs(
        new Headers({ "retry-after": "2" }),
        "try again in 8.294s",
      ),
    ).toBe(2_000 + OPENAI_RETRY_BUFFER_MS);

    expect(
      parseOpenAiRetryHintMs(
        new Headers({ "x-ratelimit-reset-tokens": "8.294s" }),
        "rate limit",
      ),
    ).toBe(8294 + OPENAI_RETRY_BUFFER_MS);

    expect(
      parseOpenAiRetryHintMs(
        new Headers(),
        "Rate limit reached. Please try again in 8.294s. Visit docs.",
      ),
    ).toBe(8294 + OPENAI_RETRY_BUFFER_MS);
  });

  it("caps long waits and falls back to exponential backoff", () => {
    expect(
      openAiRetryWaitMs({
        headers: new Headers({ "retry-after": "60" }),
        errorMessage: "rate limit",
        attempt: 1,
      }),
    ).toBe(OPENAI_RETRY_MAX_WAIT_MS);

    expect(
      openAiRetryWaitMs({
        headers: new Headers(),
        errorMessage: "rate limit",
        attempt: 1,
      }),
    ).toBe(1_000);
    expect(
      openAiRetryWaitMs({
        headers: new Headers(),
        errorMessage: "rate limit",
        attempt: 3,
      }),
    ).toBe(4_000);
  });
});

describe("openaiPostJson", () => {
  it("retries 429 after the hinted wait and then succeeds", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const sleeps: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              message:
                "Rate limit reached for gpt-4o. Please try again in 8.294s.",
            },
          },
          { status: 429 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));

    const json = await openaiPostJson({
      url: "https://api.openai.com/v1/responses",
      apiKey: "sk",
      body: { model: "gpt-4o" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      errorPrefix: "OpenAI responses failed",
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(json).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([8294 + OPENAI_RETRY_BUFFER_MS]);
    expect(warnSpy).toHaveBeenCalledWith(
      "[openai] rate limited; retrying",
      expect.objectContaining({
        component: "openai",
        handler: "http",
        step: "retry",
        result: "retry",
        error_type: "openai",
        attempt: 1,
        duration_ms: 8294 + OPENAI_RETRY_BUFFER_MS,
      }),
    );
    warnSpy.mockRestore();
  });

  it("does not retry non-429 errors", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: { message: "bad request" } }, { status: 400 }),
    );
    await expect(
      openaiPostJson({
        url: "https://api.openai.com/v1/responses",
        apiKey: "sk",
        body: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        errorPrefix: "OpenAI responses failed",
        sleep: async () => {
          throw new Error("should not sleep");
        },
      }),
    ).rejects.toThrow(/bad request/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up after max 429 attempts", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: { message: "rate limit" } }, { status: 429 }),
    );
    await expect(
      openaiPostJson({
        url: "https://api.openai.com/v1/chat/completions",
        apiKey: "sk",
        body: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        errorPrefix: "OpenAI chat failed",
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(/rate limit/);
    expect(fetchImpl).toHaveBeenCalledTimes(OPENAI_RETRY_MAX_ATTEMPTS);
    expect(warnSpy).toHaveBeenCalledTimes(OPENAI_RETRY_MAX_ATTEMPTS - 1);
    warnSpy.mockRestore();
  });
});
