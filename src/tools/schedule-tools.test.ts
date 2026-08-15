import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.js";
import type { EventStore } from "../events/store.js";
import type { EventRecord } from "../events/types.js";
import type { PlanStore } from "../plans/store.js";
import type { DayPlanRecord, PlanItemRecord } from "../plans/types.js";
import type { ReminderStore } from "../reminders/store.js";
import type { ReminderRecord } from "../reminders/types.js";
import { ToolGateway } from "./gateway.js";
import {
  createScheduleTools,
  resolveScheduleDateRange,
} from "./schedule-tools.js";

const TZ = "America/Chicago";
const NOW = new Date("2026-08-15T05:30:00.000Z");

function planItem(overrides: Partial<PlanItemRecord> = {}): PlanItemRecord {
  return {
    id: "plan-item-1",
    planId: "plan-1",
    localDate: "2026-08-15",
    text: "Call dentist",
    status: "open",
    sortOrder: 0,
    scheduledAt: new Date("2026-08-15T15:00:00.000Z"),
    reminderId: "reminder-linked",
    recurrence: null,
    rawUtterance: null,
    timezone: TZ,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function reminder(overrides: Partial<ReminderRecord> = {}): ReminderRecord {
  return {
    id: "reminder-standalone",
    text: "Buy milk",
    fireAt: new Date("2026-08-15T14:00:00.000Z"),
    timezone: TZ,
    rawUtterance: null,
    recurrence: null,
    appleSyncStatus: "pending",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "event-1",
    uid: "event-uid-1",
    recurrenceId: "",
    href: "https://caldav.example/event-1.ics",
    title: "Banyan Tree Dental",
    startAt: new Date("2026-08-15T18:00:00.000Z"),
    endAt: new Date("2026-08-15T19:00:00.000Z"),
    timezone: TZ,
    notes: null,
    alarmMinutesBefore: [15],
    recurrenceRule: null,
    isAllDay: false,
    sourceUpdatedAt: null,
    lastSeenSyncId: null,
    locationName: null,
    locationAddress: null,
    locationMapsUrl: null,
    locationLat: null,
    locationLon: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function gatewayWith(opts: {
  planItems?: PlanItemRecord[];
  reminders?: ReminderRecord[];
  events?: EventRecord[];
}) {
  const day: DayPlanRecord = {
    id: "plan-1",
    localDate: "2026-08-15",
    timezone: TZ,
    items: opts.planItems ?? [],
    createdAt: NOW,
    updatedAt: NOW,
  };
  const plans = {
    listRange: vi.fn().mockResolvedValue([day]),
    search: vi.fn().mockResolvedValue(opts.planItems ?? []),
  } as unknown as PlanStore;
  const reminders = {
    list: vi.fn().mockResolvedValue(opts.reminders ?? []),
    search: vi.fn().mockResolvedValue(opts.reminders ?? []),
  } as unknown as ReminderStore;
  const events = {
    list: vi.fn().mockResolvedValue(opts.events ?? []),
    search: vi.fn().mockResolvedValue(opts.events ?? []),
  } as unknown as EventStore;
  const gateway = new ToolGateway();
  for (const tool of createScheduleTools({
    plans,
    reminders,
    events,
    config: { USER_TIMEZONE: TZ } as AppConfig,
  })) {
    gateway.register(tool);
  }
  return { gateway, plans, reminders, events };
}

describe("resolveScheduleDateRange", () => {
  it("defaults an agenda to today's full local day", () => {
    const range = resolveScheduleDateRange({
      timeZone: TZ,
      now: NOW,
      defaultToday: true,
    });
    expect(range?.fromDate).toBe("2026-08-15");
    expect(range?.from.toISOString()).toBe("2026-08-15T05:00:00.000Z");
    expect(range?.toExclusive.toISOString()).toBe(
      "2026-08-16T05:00:00.000Z",
    );
  });

  it("rejects reversed local date ranges", () => {
    expect(() =>
      resolveScheduleDateRange({
        from: "2026-08-16",
        to: "2026-08-15",
        timeZone: TZ,
      }),
    ).toThrow(/from must not be after to/);
  });
});

describe("schedule_search", () => {
  it("combines all sources and deduplicates a plan-linked reminder", async () => {
    const linked = planItem();
    const { gateway } = gatewayWith({
      planItems: [linked],
      reminders: [
        reminder(),
        reminder({
          id: linked.reminderId!,
          text: linked.text,
          fireAt: linked.scheduledAt!,
        }),
      ],
      events: [event()],
    });

    const result = await gateway.execute("schedule_search", {
      date: "2026-08-15",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      items: Array<{ source: string; text: string }>;
      count: number;
    };
    expect(data.count).toBe(3);
    expect(data.items.map((item) => item.source)).toEqual([
      "reminder",
      "plan",
      "event",
    ]);
    expect(data.items.filter((item) => item.text === "Call dentist")).toHaveLength(
      1,
    );
  });

  it("searches plans, reminders, and events with one query", async () => {
    const { gateway, plans, reminders, events } = gatewayWith({
      planItems: [planItem()],
      reminders: [reminder()],
      events: [event()],
    });
    const result = await gateway.execute("schedule_search", {
      query: "dentist",
      limit: 10,
    });
    expect(result.ok).toBe(true);
    expect(plans.search).toHaveBeenCalledWith("dentist", 30);
    expect(reminders.search).toHaveBeenCalledWith("dentist", 30);
    expect(events.search).toHaveBeenCalledWith("dentist", 30);
  });
});
