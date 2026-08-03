import type { DeviceRoomId } from "./rooms.js";

export type DeviceKind = "desktop" | "pi" | "esp" | "other";
export type { DeviceRoomId };

export type DeviceRecord = {
  id: string;
  displayName: string;
  room: DeviceRoomId | null;
  purpose: string | null;
  kind: DeviceKind;
  capsVoice: boolean;
  capsNotify: boolean;
  firstSeenAt: Date;
  lastSeenAt: Date;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type DevicePublic = {
  id: string;
  display_name: string;
  room: DeviceRoomId | null;
  room_label: string | null;
  purpose: string | null;
  kind: DeviceKind;
  caps_voice: boolean;
  caps_notify: boolean;
  first_seen_at: string;
  last_seen_at: string;
  archived: boolean;
  online?: boolean;
};

export type HelloDeviceFields = {
  deviceId: string;
  displayName?: string;
  /** Already normalized room id from hello parse. */
  room?: DeviceRoomId;
  purpose?: string;
  kind?: DeviceKind;
  caps: { voice: boolean; notify: boolean };
};

export type DeviceMetaUpdate = {
  displayName?: string;
  room?: DeviceRoomId | null;
  purpose?: string | null;
  kind?: DeviceKind;
  archived?: boolean;
};
