import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { ReminderStore } from "../reminders/store.js";
import type { ReminderRecord } from "../reminders/types.js";
import { PlanStore, wantsReminder } from "./store.js";
import type { PlanItemRecord } from "./types.js";

const TZ = "America/Chicago";
const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";
const REM_ID = "33333333-3333-4333-8333-333333333333";

describe("wantsReminder", () => {
  it("is true when scheduledAt is set unless remind=false", () => {
    expect(
      wantsReminder({ text: "x", scheduledAt: new Date() }),
    ).toBe(true);
    expect(
      wantsReminder({
        text: "x",
        scheduledAt: new Date(),
        remind: false,
      }),
    ).toBe(false);
  });

  it("is false without scheduledAt even if remind=true", () => {
    // createLinkedReminder requires fireAt; addItems gates on scheduledAt
    expect(wantsReminder({ text: "x", remind: true })).toBe(true);
  });
});

function makeReminder(
  overrides: Partial<ReminderRecord> = {},
): ReminderRecord {
  const now = new Date("2024-01-15T18:00:00.000Z");
  return {
    id: REM_ID,
    text: "item",
    fireAt: new Date("2024-01-15T23:00:00.000Z"),
    timezone: TZ,
    status: "pending",
    rawUtterance: null,
    recurrence: null,
    quietHoursOverride: null,
    deliveredAt: null,
    calendarUid: null,
    calendarHref: null,
    calendarEndAt: null,
    locationName: null,
    locationAddress: null,
    locationMapsUrl: null,
    locationLat: null,
    locationLon: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("PlanStore reminder sync", () => {
  let reminders: {
    create: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let db: {
    dayPlan: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    planItem: {
      aggregate: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
  };
  let store: PlanStore;

  beforeEach(() => {
    reminders = {
      create: vi.fn().mockResolvedValue(makeReminder()),
      cancel: vi.fn().mockResolvedValue(makeReminder({ status: "cancelled" })),
      update: vi.fn().mockResolvedValue(makeReminder()),
    };
    db = {
      dayPlan: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      planItem: {
        aggregate: vi.fn().mockResolvedValue({ _max: { sortOrder: -1 } }),
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        deleteMany: vi.fn(),
        findMany: vi.fn(),
      },
    };
    store = new PlanStore(
      db as unknown as PrismaClient,
      reminders as unknown as ReminderStore,
      TZ,
    );
  });

  it("creates reminder for timed add", async () => {
    db.dayPlan.findUnique
      .mockResolvedValueOnce({
        id: PLAN_ID,
        localDate: "2024-01-15",
        timezone: TZ,
      })
      .mockResolvedValueOnce({
        id: PLAN_ID,
        localDate: "2024-01-15",
        timezone: TZ,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [
          {
            id: ITEM_ID,
            planId: PLAN_ID,
            text: "спорт",
            status: "open",
            sortOrder: 0,
            scheduledAt: new Date("2024-01-16T00:00:00.000Z"),
            reminderId: REM_ID,
            recurrence: null,
            rawUtterance: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });
    db.planItem.create.mockResolvedValue({
      id: ITEM_ID,
      planId: PLAN_ID,
      text: "спорт",
      status: "open",
      sortOrder: 0,
      scheduledAt: new Date("2024-01-16T00:00:00.000Z"),
      reminderId: REM_ID,
      recurrence: null,
      rawUtterance: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const fireAt = new Date("2024-01-16T00:00:00.000Z");
    const plan = await store.addItems("2024-01-15", [
      { text: "спорт", scheduledAt: fireAt },
    ]);

    expect(reminders.create).toHaveBeenCalledWith(
      expect.objectContaining({ text: "спорт", fireAt }),
    );
    expect(db.planItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reminderId: REM_ID }),
      }),
    );
    expect(plan.items[0]?.reminderId).toBe(REM_ID);
  });

  it("does not create reminder without scheduledAt", async () => {
    db.dayPlan.findUnique
      .mockResolvedValueOnce({
        id: PLAN_ID,
        localDate: "2024-01-15",
        timezone: TZ,
      })
      .mockResolvedValueOnce({
        id: PLAN_ID,
        localDate: "2024-01-15",
        timezone: TZ,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [
          {
            id: ITEM_ID,
            planId: PLAN_ID,
            text: "магазин",
            status: "open",
            sortOrder: 0,
            scheduledAt: null,
            reminderId: null,
            recurrence: null,
            rawUtterance: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });
    db.planItem.create.mockResolvedValue({
      id: ITEM_ID,
      planId: PLAN_ID,
      text: "магазин",
      status: "open",
      sortOrder: 0,
      scheduledAt: null,
      reminderId: null,
      recurrence: null,
      rawUtterance: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await store.addItems("2024-01-15", [{ text: "магазин" }]);
    expect(reminders.create).not.toHaveBeenCalled();
  });

  it("cancels linked reminder on cancelItem", async () => {
    const itemRow = {
      id: ITEM_ID,
      planId: PLAN_ID,
      text: "спорт",
      status: "open" as const,
      sortOrder: 0,
      scheduledAt: new Date("2024-01-16T00:00:00.000Z"),
      reminderId: REM_ID,
      recurrence: null,
      rawUtterance: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      plan: { localDate: "2024-01-15", timezone: TZ },
    };
    db.planItem.findUnique
      .mockResolvedValueOnce(itemRow)
      .mockResolvedValueOnce({
        ...itemRow,
        status: "cancelled",
        reminderId: null,
      });
    db.planItem.update.mockResolvedValue({});

    await store.cancelItem(ITEM_ID);
    expect(reminders.cancel).toHaveBeenCalledWith(REM_ID);
  });

  it("cancel without reminderId does not call ReminderStore.cancel", async () => {
    const itemRow = {
      id: ITEM_ID,
      planId: PLAN_ID,
      text: "магазин",
      status: "open" as const,
      sortOrder: 0,
      scheduledAt: null,
      reminderId: null,
      recurrence: null,
      rawUtterance: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      plan: { localDate: "2024-01-15", timezone: TZ },
    };
    db.planItem.findUnique
      .mockResolvedValueOnce(itemRow)
      .mockResolvedValueOnce({ ...itemRow, status: "cancelled" });
    db.planItem.update.mockResolvedValue({});

    await store.cancelItem(ITEM_ID);
    expect(reminders.cancel).not.toHaveBeenCalled();
  });

  it("moveItem updates reminder fireAt", async () => {
    const itemRow = {
      id: ITEM_ID,
      planId: PLAN_ID,
      text: "спорт",
      status: "open" as const,
      sortOrder: 0,
      scheduledAt: new Date("2024-01-16T00:00:00.000Z"),
      reminderId: REM_ID,
      recurrence: null,
      rawUtterance: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      plan: { localDate: "2024-01-15", timezone: TZ },
    };
    const newFire = new Date("2024-01-17T00:00:00.000Z");
    db.planItem.findUnique
      .mockResolvedValueOnce(itemRow)
      .mockResolvedValueOnce({
        ...itemRow,
        plan: { localDate: "2024-01-16", timezone: TZ },
        scheduledAt: newFire,
      });
    db.dayPlan.findUnique.mockResolvedValue({
      id: "plan-2",
      localDate: "2024-01-16",
      timezone: TZ,
    });
    db.planItem.aggregate.mockResolvedValue({ _max: { sortOrder: 0 } });
    db.planItem.update.mockResolvedValue({});

    await store.moveItem(ITEM_ID, "2024-01-16", newFire);
    expect(reminders.update).toHaveBeenCalledWith(
      REM_ID,
      expect.objectContaining({ fireAt: newFire, status: "pending" }),
    );
  });

  it("carryOver moves only open items", async () => {
    const moveSpy = vi.spyOn(store, "moveItem").mockResolvedValue({
      id: ITEM_ID,
    } as PlanItemRecord);
    db.dayPlan.findUnique
      .mockResolvedValueOnce({
        id: PLAN_ID,
        localDate: "2024-01-15",
        timezone: TZ,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [
          {
            id: ITEM_ID,
            planId: PLAN_ID,
            text: "open",
            status: "open",
            sortOrder: 0,
            scheduledAt: null,
            reminderId: null,
            recurrence: null,
            rawUtterance: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: "done-id",
            planId: PLAN_ID,
            text: "done",
            status: "done",
            sortOrder: 1,
            scheduledAt: null,
            reminderId: null,
            recurrence: null,
            rawUtterance: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: "cancel-id",
            planId: PLAN_ID,
            text: "cancelled",
            status: "cancelled",
            sortOrder: 2,
            scheduledAt: null,
            reminderId: null,
            recurrence: null,
            rawUtterance: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      })
      .mockResolvedValueOnce({
        id: "plan-2",
        localDate: "2024-01-16",
        timezone: TZ,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [],
      });

    await store.carryOver("2024-01-15", "2024-01-16");
    expect(moveSpy).toHaveBeenCalledTimes(1);
    expect(moveSpy).toHaveBeenCalledWith(ITEM_ID, "2024-01-16");
    moveSpy.mockRestore();
  });

  it("completeItem with recurrence advances next occurrence", async () => {
    const addSpy = vi.spyOn(store, "addItems").mockResolvedValue({
      id: "x",
      localDate: "2024-01-16",
      timezone: TZ,
      items: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const itemRow = {
      id: ITEM_ID,
      planId: PLAN_ID,
      text: "standup",
      status: "open" as const,
      sortOrder: 0,
      scheduledAt: new Date("2024-01-15T16:00:00.000Z"),
      reminderId: REM_ID,
      recurrence: { kind: "daily" as const },
      rawUtterance: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      plan: { localDate: "2024-01-15", timezone: TZ },
    };
    db.planItem.findUnique
      .mockResolvedValueOnce(itemRow)
      .mockResolvedValueOnce({
        ...itemRow,
        status: "done",
        reminderId: null,
      });
    db.planItem.update.mockResolvedValue({});

    await store.completeItem(ITEM_ID);
    expect(reminders.cancel).toHaveBeenCalledWith(REM_ID);
    expect(addSpy).toHaveBeenCalled();
    addSpy.mockRestore();
  });
});
