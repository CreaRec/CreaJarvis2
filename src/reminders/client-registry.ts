import type { WebSocket } from "ws";
import type { PlanItemPublic } from "../plans/types.js";
import type { ReminderPublic } from "./types.js";

export type ClientEvent =
  | { type: "reminder.fired"; reminder: ReminderPublic }
  | { type: "reminder.missed_digest"; reminders: ReminderPublic[] }
  | { type: "plan.today_digest"; date: string; items: PlanItemPublic[] };

/** @deprecated use ClientEvent */
export type ReminderClientEvent = ClientEvent;

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

  broadcast(event: ClientEvent): number {
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

  send(socket: WebSocket, event: ClientEvent): boolean {
    if (socket.readyState !== 1) return false;
    socket.send(JSON.stringify(event));
    return true;
  }
}
