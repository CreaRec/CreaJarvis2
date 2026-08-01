import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { ClientRegistry } from "./client-registry.js";
import type { ReminderPublic } from "./types.js";

function fakeSocket(readyState: number): WebSocket {
  return {
    readyState,
    send: vi.fn(),
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
};

describe("ClientRegistry", () => {
  it("tracks clients for hasClients", () => {
    const registry = new ClientRegistry();
    const socket = fakeSocket(1);
    expect(registry.hasClients()).toBe(false);
    registry.add(socket);
    expect(registry.hasClients()).toBe(true);
    registry.remove(socket);
    expect(registry.hasClients()).toBe(false);
  });

  it("broadcasts only to OPEN sockets", () => {
    const registry = new ClientRegistry();
    const open = fakeSocket(1);
    const closed = fakeSocket(3);
    registry.add(open);
    registry.add(closed);
    const sent = registry.broadcast({ type: "reminder.fired", reminder });
    expect(sent).toBe(1);
    expect(open.send).toHaveBeenCalledOnce();
    expect(closed.send).not.toHaveBeenCalled();
  });

  it("send returns false for non-open sockets", () => {
    const registry = new ClientRegistry();
    const closed = fakeSocket(3);
    expect(
      registry.send(closed, { type: "reminder.fired", reminder }),
    ).toBe(false);
    expect(closed.send).not.toHaveBeenCalled();
  });

  it("send returns true and writes payload for open sockets", () => {
    const registry = new ClientRegistry();
    const open = fakeSocket(1);
    expect(
      registry.send(open, {
        type: "reminder.missed_digest",
        reminders: [reminder],
      }),
    ).toBe(true);
    expect(open.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "reminder.missed_digest",
        reminders: [reminder],
      }),
    );
  });
});
