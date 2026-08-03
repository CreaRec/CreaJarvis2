import {
  type DeviceKind as PrismaDeviceKind,
  type DeviceRoom as PrismaDeviceRoom,
  type PrismaClient,
} from "@prisma/client";
import { roomLabelRu } from "./rooms.js";
import type {
  DeviceKind,
  DeviceMetaUpdate,
  DevicePublic,
  DeviceRecord,
  DeviceRoomId,
  HelloDeviceFields,
} from "./types.js";

function toRecord(row: {
  id: string;
  displayName: string;
  room: PrismaDeviceRoom | null;
  purpose: string | null;
  kind: PrismaDeviceKind;
  capsVoice: boolean;
  capsNotify: boolean;
  firstSeenAt: Date;
  lastSeenAt: Date;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}): DeviceRecord {
  return {
    id: row.id,
    displayName: row.displayName,
    room: (row.room as DeviceRoomId | null) ?? null,
    purpose: row.purpose,
    kind: row.kind as DeviceKind,
    capsVoice: row.capsVoice,
    capsNotify: row.capsNotify,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    archived: row.archived,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toPublic(
  d: DeviceRecord,
  opts?: { online?: boolean },
): DevicePublic {
  return {
    id: d.id,
    display_name: d.displayName,
    room: d.room,
    room_label: d.room ? roomLabelRu(d.room) : null,
    purpose: d.purpose,
    kind: d.kind,
    caps_voice: d.capsVoice,
    caps_notify: d.capsNotify,
    first_seen_at: d.firstSeenAt.toISOString(),
    last_seen_at: d.lastSeenAt.toISOString(),
    archived: d.archived,
    ...(opts?.online !== undefined ? { online: opts.online } : {}),
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const t = value.trim();
  return t ? t : undefined;
}

function formatRoomBit(room: DeviceRoomId | null): string | null {
  if (!room) return null;
  return `room=${roomLabelRu(room)} (${room})`;
}

export class DeviceStore {
  constructor(private readonly db: PrismaClient) {}

  async get(id: string): Promise<DeviceRecord | null> {
    const row = await this.db.device.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async list(opts?: {
    includeArchived?: boolean;
    limit?: number;
  }): Promise<DeviceRecord[]> {
    const limit = opts?.limit ?? 100;
    const rows = await this.db.device.findMany({
      where: opts?.includeArchived ? undefined : { archived: false },
      orderBy: { lastSeenAt: "desc" },
      take: limit,
    });
    return rows.map(toRecord);
  }

  async listForDebug(limit = 100): Promise<DeviceRecord[]> {
    return this.list({ includeArchived: true, limit });
  }

  /**
   * Upsert on hello. Always touches lastSeenAt + caps.
   * Non-empty client fields overwrite; empty/omitted leave DB values intact.
   * `fields.room` must already be a catalog id (from hello parse).
   */
  async upsertFromHello(fields: HelloDeviceFields): Promise<DeviceRecord> {
    const now = new Date();
    const displayName = nonEmpty(fields.displayName) ?? fields.deviceId;
    const room = fields.room;
    const purpose = nonEmpty(fields.purpose);
    const kind = fields.kind;

    const existing = await this.db.device.findUnique({
      where: { id: fields.deviceId },
    });

    if (!existing) {
      const created = await this.db.device.create({
        data: {
          id: fields.deviceId,
          displayName,
          room: room ?? null,
          purpose: purpose ?? null,
          kind: kind ?? "desktop",
          capsVoice: fields.caps.voice,
          capsNotify: fields.caps.notify,
          firstSeenAt: now,
          lastSeenAt: now,
          archived: false,
        },
      });
      return toRecord(created);
    }

    const updated = await this.db.device.update({
      where: { id: fields.deviceId },
      data: {
        lastSeenAt: now,
        capsVoice: fields.caps.voice,
        capsNotify: fields.caps.notify,
        archived: false,
        ...(nonEmpty(fields.displayName)
          ? { displayName: nonEmpty(fields.displayName)! }
          : {}),
        ...(room !== undefined ? { room } : {}),
        ...(purpose !== undefined ? { purpose } : {}),
        ...(kind ? { kind } : {}),
      },
    });
    return toRecord(updated);
  }

  async updateMeta(
    id: string,
    patch: DeviceMetaUpdate,
  ): Promise<DeviceRecord | null> {
    const existing = await this.db.device.findUnique({ where: { id } });
    if (!existing) return null;

    const data: {
      displayName?: string;
      room?: DeviceRoomId | null;
      purpose?: string | null;
      kind?: DeviceKind;
      archived?: boolean;
    } = {};

    if (patch.displayName !== undefined) {
      const name = nonEmpty(patch.displayName);
      if (!name) {
        throw new Error("displayName must be non-empty");
      }
      data.displayName = name;
    }
    if (patch.room !== undefined) {
      data.room = patch.room;
    }
    if (patch.purpose !== undefined) {
      data.purpose =
        patch.purpose === null ? null : (nonEmpty(patch.purpose) ?? null);
    }
    if (patch.kind !== undefined) data.kind = patch.kind;
    if (patch.archived !== undefined) data.archived = patch.archived;

    const updated = await this.db.device.update({
      where: { id },
      data,
    });
    return toRecord(updated);
  }

  async archive(id: string): Promise<DeviceRecord | null> {
    return this.updateMeta(id, { archived: true });
  }
}

export function formatDeviceSessionBlock(opts: {
  current: DeviceRecord | null;
  onlineIds: Set<string>;
  siblings: DeviceRecord[];
}): string {
  const lines: string[] = ["Devices:"];
  if (opts.current) {
    const bits = [
      opts.current.displayName,
      formatRoomBit(opts.current.room),
      opts.current.purpose ? `purpose=${opts.current.purpose}` : null,
      `kind=${opts.current.kind}`,
    ].filter(Boolean);
    lines.push(`This session is on: ${bits.join(", ")} (id=${opts.current.id}).`);
  } else {
    lines.push("This session device is not in the inventory yet.");
  }

  const others = opts.siblings.filter(
    (d) => !opts.current || d.id !== opts.current.id,
  );
  if (others.length === 0) {
    lines.push("No other household devices registered.");
  } else {
    lines.push("Other devices:");
    for (const d of others.slice(0, 20)) {
      const online = opts.onlineIds.has(d.id) ? "online" : "offline";
      const bits = [
        d.displayName,
        formatRoomBit(d.room),
        d.purpose ? `purpose=${d.purpose}` : null,
        online,
      ].filter(Boolean);
      lines.push(`- ${bits.join(", ")} (${d.id})`);
    }
  }

  lines.push(
    "When the user asks about devices / rooms → device_list (read-only). Name/room/purpose are set only in client Settings.",
  );
  return lines.join("\n");
}
