import { logger } from "../log.js";
import { openaiErrorMessage } from "./errors.js";

export const OPENAI_RETRY_MAX_ATTEMPTS = 4;
export const OPENAI_RETRY_MAX_WAIT_MS = 15_000;
const OPENAI_RETRY_BASE_WAIT_MS = 1_000;
export const OPENAI_RETRY_BUFFER_MS = 250;

export type SleepFn = (ms: number) => Promise<void>;

export function isOpenAiRetryableStatus(status: number): boolean {
  return status === 429;
}

export async function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse OpenAI duration strings like `8.294s` or `1m30s`. */
export function parseOpenAiDurationMs(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = raw.trim();
  const match = value.match(/^(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/i);
  if (!match || (match[1] === undefined && match[2] === undefined)) return null;
  const minutes = match[1] === undefined ? 0 : Number(match[1]);
  const seconds = match[2] === undefined ? 0 : Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return (minutes * 60 + seconds) * 1000;
}

export function parseOpenAiRetryHintMs(
  headers: Headers,
  errorMessage: string,
): number | null {
  const retryAfter = headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000 + OPENAI_RETRY_BUFFER_MS;
    }
  }

  const fromReset = parseOpenAiDurationMs(
    headers.get("x-ratelimit-reset-tokens") ?? undefined,
  );
  if (fromReset != null) return fromReset + OPENAI_RETRY_BUFFER_MS;

  const bodyMatch = errorMessage.match(/try again in\s+([\d.]+)\s*s/i);
  if (bodyMatch) {
    const seconds = Number(bodyMatch[1]);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000 + OPENAI_RETRY_BUFFER_MS;
    }
  }
  return null;
}

export function openAiRetryWaitMs(input: {
  headers: Headers;
  errorMessage: string;
  attempt: number;
}): number {
  const hinted = parseOpenAiRetryHintMs(input.headers, input.errorMessage);
  const fallback = Math.min(
    OPENAI_RETRY_BASE_WAIT_MS * 2 ** Math.max(0, input.attempt - 1),
    OPENAI_RETRY_MAX_WAIT_MS,
  );
  const wait = hinted ?? fallback;
  return Math.min(Math.max(0, wait), OPENAI_RETRY_MAX_WAIT_MS);
}

export async function openaiPostJson(input: {
  url: string;
  apiKey: string;
  body: Record<string, unknown>;
  fetchImpl: typeof fetch;
  errorPrefix: string;
  sleep?: SleepFn;
  maxAttempts?: number;
}): Promise<unknown> {
  const sleep = input.sleep ?? defaultSleep;
  const maxAttempts = input.maxAttempts ?? OPENAI_RETRY_MAX_ATTEMPTS;
  const payload = JSON.stringify(input.body);
  let lastError = `${input.errorPrefix} (unknown)`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await input.fetchImpl(input.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: payload,
    });
    const json = (await response.json()) as unknown;
    if (response.ok) return json;

    const message = openaiErrorMessage(json);
    lastError = `${input.errorPrefix} (${response.status}): ${message}`;

    const canRetry =
      isOpenAiRetryableStatus(response.status) && attempt < maxAttempts;
    if (!canRetry) {
      throw new Error(lastError);
    }

    const durationMs = openAiRetryWaitMs({
      headers: response.headers,
      errorMessage: message,
      attempt,
    });
    logger.warn("[openai] rate limited; retrying", {
      component: "openai",
      handler: "http",
      step: "retry",
      result: "retry",
      error_type: "openai",
      attempt,
      duration_ms: durationMs,
    });
    await sleep(durationMs);
  }

  throw new Error(lastError);
}
