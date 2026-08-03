import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  DeviceStore,
  formatDeviceSessionBlock,
  toPublic,
} from "./store.js";

const DEVICE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function row(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-08-02T12:00:00.000Z");
  return {
    id: DEVICE_ID,
    displayName: "Mac",
    room: "office",
    purpose: "рабочий",
    kind: "desktop" as const,
    capsVoice: true,
    capsNotify: true,
    firstSeenAt: now,
    lastSeenAt: now,
    archived: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("DeviceStore", () => {
  let db: {
    device: {
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  let store: DeviceStore;

  beforeEach(() => {
    db = {
      device: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    };
    store = new DeviceStore(db as unknown as PrismaClient);
  });

  it("creates on first hello", async () => {
    db.device.findUnique.mockResolvedValue(null);
    db.device.create.mockResolvedValue(row());

    const result = await store.upsertFromHello({
      deviceId: DEVICE_ID,
      displayName: "Mac",
      room: "office",
      purpose: "рабочий",
      caps: { voice: true, notify: true },
    });

    expect(result.displayName).toBe("Mac");
    expect(db.device.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: DEVICE_ID,
          displayName: "Mac",
          room: "office",
          purpose: "рабочий",
          kind: "desktop",
        }),
      }),
    );
  });

  it("does not wipe room/purpose when hello omits them", async () => {
    db.device.findUnique.mockResolvedValue(row());
    db.device.update.mockResolvedValue(
      row({ capsNotify: false, displayName: "Mac" }),
    );

    await store.upsertFromHello({
      deviceId: DEVICE_ID,
      caps: { voice: true, notify: false },
    });

    expect(db.device.update).toHaveBeenCalledWith({
      where: { id: DEVICE_ID },
      data: expect.objectContaining({
        capsVoice: true,
        capsNotify: false,
        archived: false,
      }),
    });
    const data = db.device.update.mock.calls[0]![0].data as Record<
      string,
      unknown
    >;
    expect(data).not.toHaveProperty("room");
    expect(data).not.toHaveProperty("purpose");
    expect(data).not.toHaveProperty("displayName");
  });

  it("overwrites room when hello sends catalog id", async () => {
    db.device.findUnique.mockResolvedValue(row());
    db.device.update.mockResolvedValue(row({ room: "kitchen_living" }));

    await store.upsertFromHello({
      deviceId: DEVICE_ID,
      room: "kitchen_living",
      caps: { voice: true, notify: true },
    });

    expect(db.device.update).toHaveBeenCalledWith({
      where: { id: DEVICE_ID },
      data: expect.objectContaining({ room: "kitchen_living" }),
    });
  });

  it("updateMeta can clear room with null", async () => {
    db.device.findUnique.mockResolvedValue(row());
    db.device.update.mockResolvedValue(row({ room: null }));

    const updated = await store.updateMeta(DEVICE_ID, { room: null });
    expect(updated?.room).toBeNull();
    expect(db.device.update).toHaveBeenCalledWith({
      where: { id: DEVICE_ID },
      data: { room: null },
    });
  });

  it("toPublic maps snake_case and room_label", () => {
    expect(toPublic(row() as never, { online: true })).toEqual(
      expect.objectContaining({
        id: DEVICE_ID,
        display_name: "Mac",
        room: "office",
        room_label: "Офис",
        online: true,
      }),
    );
  });
});

describe("formatDeviceSessionBlock", () => {
  it("describes current and siblings with room labels", () => {
    const now = new Date();
    const current = {
      id: DEVICE_ID,
      displayName: "Mac",
      room: "office" as const,
      purpose: "работа",
      kind: "desktop" as const,
      capsVoice: true,
      capsNotify: true,
      firstSeenAt: now,
      lastSeenAt: now,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    const other = {
      ...current,
      id: OTHER_ID,
      displayName: "Pi",
      room: "kitchen_living" as const,
    };
    const block = formatDeviceSessionBlock({
      current,
      onlineIds: new Set([DEVICE_ID]),
      siblings: [current, other],
    });
    expect(block).toContain("This session is on: Mac");
    expect(block).toContain("room=Офис (office)");
    expect(block).toContain("Pi");
    expect(block).toContain("offline");
    expect(block).toContain("device_list");
  });
});
