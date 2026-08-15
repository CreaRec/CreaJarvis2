import { describe, expect, it } from "vitest";
import { loadConfig, resolveTelegramConfig } from "./config.js";

function baseOverrides(): Record<string, string> {
  return {
    OPENAI_API_KEY: "sk-test",
    JARVIS_GATEWAY_TOKEN: "token-ok-1",
    BRAVE_API_KEY: "brave",
    GOOGLE_PLACES_API_KEY: "places",
  };
}

describe("resolveTelegramConfig", () => {
  it("disables when token is empty", () => {
    const config = loadConfig({
      ...baseOverrides(),
      TELEGRAM_BOT_TOKEN: "",
    });
    expect(resolveTelegramConfig(config)).toEqual({ enabled: false });
  });

  it("enables with token only (allowlist is in DB)", () => {
    const config = loadConfig({
      ...baseOverrides(),
      TELEGRAM_BOT_TOKEN: "123:abc",
    });
    const resolved = resolveTelegramConfig(config);
    expect(resolved.enabled).toBe(true);
    if (!resolved.enabled) return;
    expect(resolved.botToken).toBe("123:abc");
    expect(resolved.chatModel).toBe("gpt-4o");
    expect("allowedUserIds" in resolved).toBe(false);
  });
});
