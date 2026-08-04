import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { DeviceRegistry } from "./device-registry.js";
import type { ReminderPublic } from "./types.js";

function fakeSocket(readyState: number): WebSocket {
  return {
    readyState,
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as WebSocket;
}

const reminder: ReminderPublic = {
  id: "00000000-0000-4000-8000-000000000001",
  text: "test",
  fire_at_iso: "2024-01-15T18:00:00.000Z",
  fire_at_local: "15.01.2024, 12:00:00",
  status: "pending",
  recurrence: null,
  raw_utterance: null,
  timezone: "America/Chicago",
  delivered_at: null,
  created_at: "2024-01-15T17:00:00.000Z",
  calendar_uid: null,
  has_calendar_event: false,
  calendar_end_at_iso: null,
};

describe("DeviceRegistry", () => {
  it("tracks notifiable clients", () => {
    const registry = new DeviceRegistry();
    const socket = fakeSocket(1);
    expect(registry.hasNotifiableClients()).toBe(false);
    registry.register("d1", socket, "Mac", { voice: true, notify: true });
    expect(registry.hasNotifiableClients()).toBe(true);
    registry.unregister(socket);
    expect(registry.hasNotifiableClients()).toBe(false);
  });

  it("ignores notify:false devices for hasNotifiableClients and broadcast", () => {
    const registry = new DeviceRegistry();
    const silent = fakeSocket(1);
    const loud = fakeSocket(1);
    registry.register("silent", silent, "S", { voice: true, notify: false });
    expect(registry.hasNotifiableClients()).toBe(false);
    registry.register("loud", loud, "L", { voice: true, notify: true });
    expect(registry.hasNotifiableClients()).toBe(true);
    const sent = registry.broadcast({ type: "reminder.fired", reminder });
    expect(sent).toBe(1);
    expect(loud.send).toHaveBeenCalledOnce();
    expect(silent.send).not.toHaveBeenCalled();
  });

  it("broadcasts only to OPEN notifiable sockets", () => {
    const registry = new DeviceRegistry();
    const open = fakeSocket(1);
    const closed = fakeSocket(3);
    registry.register("a", open, "A", { voice: true, notify: true });
    registry.register("b", closed, "B", { voice: true, notify: true });
    const sent = registry.broadcast({ type: "reminder.fired", reminder });
    expect(sent).toBe(1);
    expect(open.send).toHaveBeenCalledOnce();
    expect(closed.send).not.toHaveBeenCalled();
  });

  it("replaces socket for same deviceId", () => {
    const registry = new DeviceRegistry();
    const first = fakeSocket(1);
    const second = fakeSocket(1);
    registry.register("d1", first, "Mac", { voice: true, notify: true });
    registry.register("d1", second, "Mac", { voice: true, notify: true });
    expect(first.close).toHaveBeenCalled();
    expect(registry.get("d1")?.socket).toBe(second);
    // stale close must not drop the new registration
    const result = registry.unregister(first);
    expect(result.wasVoiceOwner).toBe(false);
    expect(registry.get("d1")?.socket).toBe(second);
  });

  it("claims exclusive voice and reports busy", () => {
    const registry = new DeviceRegistry();
    const a = fakeSocket(1);
    const b = fakeSocket(1);
    registry.register("a", a, "Alpha", { voice: true, notify: true });
    registry.register("b", b, "Beta", { voice: true, notify: true });
    expect(registry.claimVoice("a")).toEqual({ ok: true });
    expect(registry.claimVoice("b")).toEqual({
      ok: false,
      ownerDeviceId: "a",
      ownerDisplayName: "Alpha",
    });
    expect(registry.claimVoice("a")).toEqual({ ok: true });
    registry.releaseVoice("a");
    expect(registry.claimVoice("b")).toEqual({ ok: true });
  });

  it("releases voice ownership on unregister of owner", () => {
    const registry = new DeviceRegistry();
    const a = fakeSocket(1);
    registry.register("a", a, "Alpha", { voice: true, notify: true });
    registry.claimVoice("a");
    const result = registry.unregister(a);
    expect(result.wasVoiceOwner).toBe(true);
    expect(registry.getVoiceOwnerDeviceId()).toBeNull();
  });

  it("send returns false for non-open sockets", () => {
    const registry = new DeviceRegistry();
    const closed = fakeSocket(3);
    expect(
      registry.send(closed, { type: "reminder.fired", reminder }),
    ).toBe(false);
    expect(closed.send).not.toHaveBeenCalled();
  });

  it("listConnected and onlineIds", () => {
    const registry = new DeviceRegistry();
    const open = fakeSocket(1);
    const closed = fakeSocket(3);
    registry.register("a", open, "A", { voice: true, notify: true }, {
      room: "кухня",
    });
    registry.register("b", closed, "B", { voice: true, notify: true });
    expect(registry.listConnected()).toHaveLength(2);
    expect(registry.get("a")?.room).toBe("кухня");
    expect([...registry.onlineIds()]).toEqual(["a"]);
  });
});
