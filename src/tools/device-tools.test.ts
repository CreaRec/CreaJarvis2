import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { DeviceRegistry } from "../reminders/device-registry.js";
import type { DeviceStore } from "../devices/store.js";
import { ToolGateway } from "./gateway.js";
import { createDeviceTools } from "./device-tools.js";

const DEVICE_ID = "11111111-1111-4111-8111-111111111111";

function fakeSocket(): WebSocket {
  return {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as WebSocket;
}

function row(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: DEVICE_ID,
    displayName: "Mac",
    room: "кабинет",
    purpose: "работа",
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

describe("createDeviceTools", () => {
  let store: {
    list: ReturnType<typeof vi.fn>;
    updateMeta: ReturnType<typeof vi.fn>;
  };
  let registry: DeviceRegistry;
  let gw: ToolGateway;

  beforeEach(() => {
    store = {
      list: vi.fn(),
      updateMeta: vi.fn(),
    };
    registry = new DeviceRegistry();
    gw = new ToolGateway();
    for (const tool of createDeviceTools({
      store: store as unknown as DeviceStore,
      registry,
    })) {
      gw.register(tool);
    }
  });

  it("device_list marks online devices", async () => {
    store.list.mockResolvedValue([row()]);
    registry.register(DEVICE_ID, fakeSocket(), "Mac", {
      voice: true,
      notify: true,
    });

    const result = await gw.execute("device_list", {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      devices: Array<{ id: string; online: boolean }>;
    };
    expect(data.devices[0]?.online).toBe(true);
  });

  it("does not register device_update", () => {
    expect(gw.listRealtimeTools().map((t) => t.name)).toEqual(["device_list"]);
  });
});
