import type { WebSocket } from "ws";
import type { PlanItemPublic } from "../plans/types.js";
import type { DeviceCaps } from "../server/voice-protocol.js";
import type { ReminderPublic } from "./types.js";

export type ClientEvent =
  | { type: "reminder.fired"; reminder: ReminderPublic }
  | { type: "reminder.missed_digest"; reminders: ReminderPublic[] }
  | { type: "plan.today_digest"; date: string; items: PlanItemPublic[] };

/** @deprecated use ClientEvent */
export type ReminderClientEvent = ClientEvent;

export type RegisteredDevice = {
  deviceId: string;
  socket: WebSocket;
  displayName: string;
  caps: DeviceCaps;
  connectedAt: Date;
};

export type ClaimVoiceResult =
  | { ok: true }
  | { ok: false; ownerDeviceId: string; ownerDisplayName: string };

/**
 * Presence + exclusive voice ownership for multi-device LAN Core.
 * One deviceId maps to at most one live socket.
 */
export class DeviceRegistry {
  private readonly devices = new Map<string, RegisteredDevice>();
  private readonly socketToDevice = new Map<WebSocket, string>();
  private voiceOwnerDeviceId: string | null = null;

  register(
    deviceId: string,
    socket: WebSocket,
    displayName: string,
    caps: DeviceCaps,
  ): RegisteredDevice {
    const existing = this.devices.get(deviceId);
    if (existing && existing.socket !== socket) {
      this.socketToDevice.delete(existing.socket);
      try {
        if (existing.socket.readyState === 1 /* OPEN */) {
          existing.socket.close();
        }
      } catch {
        // ignore close errors on replaced socket
      }
    }

    const entry: RegisteredDevice = {
      deviceId,
      socket,
      displayName: displayName || deviceId,
      caps,
      connectedAt: new Date(),
    };
    this.devices.set(deviceId, entry);
    this.socketToDevice.set(socket, deviceId);
    return entry;
  }

  /**
   * Unregister by socket. Ignores stale sockets replaced by a newer connect.
   * Returns whether this socket was the voice owner at unregister time.
   */
  unregister(socket: WebSocket): {
    deviceId: string | null;
    wasVoiceOwner: boolean;
  } {
    const deviceId = this.socketToDevice.get(socket) ?? null;
    this.socketToDevice.delete(socket);
    if (!deviceId) {
      return { deviceId: null, wasVoiceOwner: false };
    }
    const current = this.devices.get(deviceId);
    if (!current || current.socket !== socket) {
      return { deviceId, wasVoiceOwner: false };
    }
    this.devices.delete(deviceId);
    const wasVoiceOwner = this.voiceOwnerDeviceId === deviceId;
    if (wasVoiceOwner) {
      this.voiceOwnerDeviceId = null;
    }
    return { deviceId, wasVoiceOwner };
  }

  get(deviceId: string): RegisteredDevice | undefined {
    return this.devices.get(deviceId);
  }

  deviceIdForSocket(socket: WebSocket): string | null {
    return this.socketToDevice.get(socket) ?? null;
  }

  hasNotifiableClients(): boolean {
    for (const d of this.devices.values()) {
      if (d.caps.notify && d.socket.readyState === 1 /* OPEN */) {
        return true;
      }
    }
    return false;
  }

  /** @deprecated use hasNotifiableClients */
  hasClients(): boolean {
    return this.hasNotifiableClients();
  }

  broadcast(event: ClientEvent): number {
    const payload = JSON.stringify(event);
    let sent = 0;
    for (const d of this.devices.values()) {
      if (!d.caps.notify) continue;
      if (d.socket.readyState !== 1 /* OPEN */) continue;
      d.socket.send(payload);
      sent += 1;
    }
    return sent;
  }

  send(socket: WebSocket, event: ClientEvent): boolean {
    if (socket.readyState !== 1) return false;
    socket.send(JSON.stringify(event));
    return true;
  }

  claimVoice(deviceId: string): ClaimVoiceResult {
    if (
      this.voiceOwnerDeviceId != null &&
      this.voiceOwnerDeviceId !== deviceId
    ) {
      const owner = this.devices.get(this.voiceOwnerDeviceId);
      return {
        ok: false,
        ownerDeviceId: this.voiceOwnerDeviceId,
        ownerDisplayName: owner?.displayName ?? this.voiceOwnerDeviceId,
      };
    }
    this.voiceOwnerDeviceId = deviceId;
    return { ok: true };
  }

  releaseVoice(deviceId: string): void {
    if (this.voiceOwnerDeviceId === deviceId) {
      this.voiceOwnerDeviceId = null;
    }
  }

  getVoiceOwnerDeviceId(): string | null {
    return this.voiceOwnerDeviceId;
  }

  isVoiceOwner(deviceId: string): boolean {
    return this.voiceOwnerDeviceId === deviceId;
  }

  getVoiceOwner(): RegisteredDevice | null {
    if (!this.voiceOwnerDeviceId) return null;
    return this.devices.get(this.voiceOwnerDeviceId) ?? null;
  }
}

/** @deprecated use DeviceRegistry */
export const ClientRegistry = DeviceRegistry;
