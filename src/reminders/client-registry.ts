import type { WebSocket } from "ws";
import type { ReminderPublic } from "./types.js";

export type ReminderClientEvent =
  | { type: "reminder.fired"; reminder: ReminderPublic }
  | { type: "reminder.missed_digest"; reminders: ReminderPublic[] };

export class ClientRegistry {
  private readonly clients = new Set<WebSocket>();

  add(socket: WebSocket): void {
    this.clients.add(socket);
  }

  remove(socket: WebSocket): void {
    this.clients.delete(socket);
  }

  hasClients(): boolean {
    return this.clients.size > 0;
  }

  broadcast(event: ReminderClientEvent): number {
    const payload = JSON.stringify(event);
    let sent = 0;
    for (const socket of this.clients) {
      if (socket.readyState === 1 /* OPEN */) {
        socket.send(payload);
        sent += 1;
      }
    }
    return sent;
  }

  send(socket: WebSocket, event: ReminderClientEvent): boolean {
    if (socket.readyState !== 1) return false;
    socket.send(JSON.stringify(event));
    return true;
  }
}
