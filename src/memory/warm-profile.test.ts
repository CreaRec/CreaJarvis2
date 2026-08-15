import { describe, expect, it } from "vitest";
import {
  buildSessionInstructions,
  formatWarmProfileBlock,
} from "./warm-profile.js";

describe("formatWarmProfileBlock", () => {
  it("formats user and directives sections", () => {
    const block = formatWarmProfileBlock({
      user: "- likes tea",
      directives: "- be brief",
    });
    expect(block).toContain(
      "INFORMATION THE USER HAS SHARED IN PRIOR CONVERSATIONS:",
    );
    expect(block).toContain("- likes tea");
    expect(block).toContain("STANDING INSTRUCTIONS FROM THE USER:");
    expect(block).toContain("- be brief");
  });

  it("omits empty sections", () => {
    expect(formatWarmProfileBlock({ user: "", directives: "" })).toBe("");
    expect(formatWarmProfileBlock({ user: "  ", directives: "- x" })).toBe(
      "STANDING INSTRUCTIONS FROM THE USER:\n- x",
    );
  });
});

describe("buildSessionInstructions", () => {
  it("embeds reminder defaults and timezone", () => {
    const text = buildSessionInstructions("", {
      morningHour: 9,
      afternoonHour: 13,
      eveningHour: 19,
      nightHour: 22,
      timeZone: "Europe/Moscow",
    });
    expect(text).toContain("Language: speak and understand Russian only");
    expect(text).toContain("Do not switch the conversation to English, Polish");
    expect(text).toContain("User timezone: Europe/Moscow");
    expect(text).toContain("CRITICAL speech:");
    expect(text).toContain("ALWAYS speak `*_local`");
    expect(text).toContain("today at 9:00 / 13:00 / 19:00 / 22:00");
    expect(text).toContain("reminder_* tools");
    expect(text).toContain("Day plans:");
    expect(text).toContain("plan_* tools");
    expect(text).toContain("NOT memory_save");
    expect(text).toContain("Never use tomorrow");
    expect(text).toContain("raw_utterance");
    expect(text).toContain("do not rewrite");
    expect(text).toContain("memory_timeline");
    expect(text).toContain("created_at");
  });

  it("falls back to Chicago defaults", () => {
    const text = buildSessionInstructions("warm");
    expect(text).toContain("User timezone: America/Chicago");
    expect(text).toContain("today at 10:00 / 14:00 / 18:00 / 21:00");
    expect(text).toContain("warm");
    expect(text).toContain("plan_get");
    expect(text).toContain("schedule_search");
    expect(text).toContain("plans, reminders, and synced Apple events");
    expect(text).toContain("CRITICAL date mapping");
    expect(text).toContain("Themes (ideas / projects / trips / lists):");
    expect(text).toContain("theme_*");
    expect(text).toContain("theme_add_entries");
    expect(text).toContain("persist the details in the same turn");
    expect(text).toContain("exact carrier");
    expect(text).toContain("Only claim that trip information was saved");
    expect(text).toContain("kind=list");
    expect(text).toContain("checklist");
    expect(text).toContain("memory_timeline");
    expect(text).toContain("Devices:");
    expect(text).toContain("device_list");
    expect(text).toContain("client Settings");
    expect(text).not.toContain("device_update");
    expect(text).not.toContain("Apple Calendar:");
  });

  it("includes Apple Calendar rules when enabled", () => {
    const text = buildSessionInstructions("", {
      morningHour: 10,
      afternoonHour: 14,
      eveningHour: 18,
      nightHour: 21,
      timeZone: "America/Chicago",
      calendarEnabled: true,
    });
    expect(text).toContain("Apple Calendar:");
    expect(text).toContain("calendar_create_event");
    expect(text).toContain("calendar_create_event directly");
    expect(text).not.toContain("offer_calendar");
    expect(text).toContain("calendar_list");
    expect(text).toContain("calendar_sync");
    expect(text).toContain("Do NOT call calendar_sync automatically");
    expect(text).toContain("alarm_minutes_before");
    expect(text).toContain("apple_sync_status stays pending");
  });
});
