import { describe, expect, it } from "vitest";
import { loadConfig, resolveICloudCalendarConfig } from "../config.js";

describe("resolveICloudCalendarConfig", () => {
  it("disables when all empty", () => {
    const config = loadConfig({
      OPENAI_API_KEY: "sk",
      JARVIS_GATEWAY_TOKEN: "token-ok-1",
      BRAVE_API_KEY: "brave",
      GOOGLE_PLACES_API_KEY: "places",
      ICLOUD_CALDAV_USERNAME: "",
      ICLOUD_CALDAV_PASSWORD: "",
      ICLOUD_CALDAV_CALENDAR_URL: "",
    });
    expect(resolveICloudCalendarConfig(config)).toEqual({ enabled: false });
  });

  it("enables when all set", () => {
    const config = loadConfig({
      OPENAI_API_KEY: "sk",
      JARVIS_GATEWAY_TOKEN: "token-ok-1",
      BRAVE_API_KEY: "brave",
      GOOGLE_PLACES_API_KEY: "places",
      ICLOUD_CALDAV_USERNAME: "a@icloud.com",
      ICLOUD_CALDAV_PASSWORD: "xxxx-xxxx-xxxx-xxxx",
      ICLOUD_CALDAV_CALENDAR_URL: "https://caldav.icloud.com/x/calendars/home/",
    });
    expect(resolveICloudCalendarConfig(config)).toEqual({
      enabled: true,
      username: "a@icloud.com",
      password: "xxxx-xxxx-xxxx-xxxx",
      calendarUrl: "https://caldav.icloud.com/x/calendars/home/",
    });
  });

  it("throws on partial config", () => {
    const config = loadConfig({
      OPENAI_API_KEY: "sk",
      JARVIS_GATEWAY_TOKEN: "token-ok-1",
      BRAVE_API_KEY: "brave",
      GOOGLE_PLACES_API_KEY: "places",
      ICLOUD_CALDAV_USERNAME: "a@icloud.com",
      ICLOUD_CALDAV_PASSWORD: "",
      ICLOUD_CALDAV_CALENDAR_URL: "",
    });
    expect(() => resolveICloudCalendarConfig(config)).toThrow(/Partial ICLOUD/);
  });
});
