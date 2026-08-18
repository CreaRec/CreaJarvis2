import { describe, expect, it } from "vitest";
import {
  eventTextTokens,
  findDuplicateCandidates,
  intervalsOverlap,
  tokensOverlap,
} from "./duplicates.js";

const TZ = "America/Chicago";

describe("eventTextTokens", () => {
  it("keeps distinctive names and drops appointment stopwords", () => {
    const tokens = eventTextTokens(
      "Appointment with Dr. Jose G. Millar",
      "16010 Park Valley Dr, Round Rock, TX",
    );
    expect(tokens.has("millar")).toBe(true);
    expect(tokens.has("jose")).toBe(true);
    expect(tokens.has("park")).toBe(true);
    expect(tokens.has("valley")).toBe(true);
    expect(tokens.has("appointment")).toBe(false);
    expect(tokens.has("with")).toBe(false);
  });
});

describe("tokensOverlap", () => {
  it("matches Millar across slightly different titles", () => {
    const a = eventTextTokens("Appointment with Dr. Jose G. Millar");
    const b = eventTextTokens("Appointment: Checkup with Gabriel C Millar MD");
    expect(tokensOverlap(a, b)).toBe(true);
  });

  it("does not match unrelated titles", () => {
    const a = eventTextTokens("Gym");
    const b = eventTextTokens("Team standup");
    expect(tokensOverlap(a, b)).toBe(false);
  });
});

describe("intervalsOverlap", () => {
  it("detects overlapping hours", () => {
    expect(
      intervalsOverlap(
        new Date("2026-08-26T21:00:00.000Z"),
        new Date("2026-08-26T22:00:00.000Z"),
        new Date("2026-08-26T21:30:00.000Z"),
        new Date("2026-08-26T22:30:00.000Z"),
      ),
    ).toBe(true);
  });

  it("does not treat adjacent intervals as overlap", () => {
    expect(
      intervalsOverlap(
        new Date("2026-08-26T16:00:00.000Z"),
        new Date("2026-08-26T17:00:00.000Z"),
        new Date("2026-08-26T21:00:00.000Z"),
        new Date("2026-08-26T22:00:00.000Z"),
      ),
    ).toBe(false);
  });
});

describe("findDuplicateCandidates", () => {
  const gabriel = {
    uid: "apple-gabriel",
    href: "https://caldav.example/gabriel.ics",
    event_id: null as string | null,
    title: "Appointment: Checkup with Gabriel C Millar MD",
    location: "PARK VALLEY PEDI",
    start: new Date("2026-08-26T21:00:00.000Z"),
    end: new Date("2026-08-26T22:00:00.000Z"),
    isAllDay: false,
  };

  it("flags a similar doctor visit later the same day", () => {
    const matches = findDuplicateCandidates({
      title: "Appointment with Dr. Jose G. Millar",
      location: "16010 Park Valley Dr, Ste 300, Round Rock, TX 78681",
      start: new Date("2026-08-26T16:00:00.000Z"),
      end: new Date("2026-08-26T17:00:00.000Z"),
      timeZone: TZ,
      events: [gabriel],
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.reasons).toEqual(["similar_same_day"]);
    expect(matches[0]?.uid).toBe("apple-gabriel");
  });

  it("flags a time overlap even with a different title", () => {
    const matches = findDuplicateCandidates({
      title: "Dentist",
      start: new Date("2026-08-26T21:00:00.000Z"),
      end: new Date("2026-08-26T22:00:00.000Z"),
      timeZone: TZ,
      events: [
        {
          uid: "standup",
          href: "https://caldav.example/standup.ics",
          title: "Team standup",
          start: new Date("2026-08-26T21:00:00.000Z"),
          end: new Date("2026-08-26T21:30:00.000Z"),
        },
      ],
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.reasons).toEqual(["time_overlap"]);
  });

  it("ignores an unrelated event on the same day", () => {
    const matches = findDuplicateCandidates({
      title: "Dentist",
      start: new Date("2026-08-26T16:00:00.000Z"),
      end: new Date("2026-08-26T17:00:00.000Z"),
      timeZone: TZ,
      events: [
        {
          uid: "gym",
          href: "https://caldav.example/gym.ics",
          title: "Gym",
          start: new Date("2026-08-26T21:00:00.000Z"),
          end: new Date("2026-08-26T22:00:00.000Z"),
        },
      ],
    });
    expect(matches).toHaveLength(0);
  });
});
