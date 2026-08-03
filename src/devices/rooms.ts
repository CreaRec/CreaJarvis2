/** Controlled vocabulary of household rooms (ADR-006). */

export const DEVICE_ROOM_IDS = [
  "master_bedroom",
  "master_bathroom",
  "kitchen_living",
  "garage",
  "office",
  "poker_room",
  "play_room",
  "kids_room",
  "kids_office",
  "guest_room",
] as const;

export type DeviceRoomId = (typeof DEVICE_ROOM_IDS)[number];

export type DeviceRoomDef = {
  id: DeviceRoomId;
  labelRu: string;
  /** Lowercase aliases including the id itself. */
  aliases: readonly string[];
};

export const DEVICE_ROOMS: readonly DeviceRoomDef[] = [
  {
    id: "master_bedroom",
    labelRu: "Спальня",
    aliases: ["master_bedroom", "master bedroom", "спальня"],
  },
  {
    id: "master_bathroom",
    labelRu: "Ванная",
    aliases: ["master_bathroom", "master bathroom", "ванная"],
  },
  {
    id: "kitchen_living",
    labelRu: "Кухня",
    aliases: [
      "kitchen_living",
      "kitchen",
      "living room",
      "livingroom",
      "кухня",
    ],
  },
  {
    id: "garage",
    labelRu: "Гараж",
    aliases: ["garage", "гараж"],
  },
  {
    id: "office",
    labelRu: "Офис",
    aliases: ["office", "офис", "кабинет"],
  },
  {
    id: "poker_room",
    labelRu: "Покерная комната",
    aliases: ["poker_room", "poker room", "покерная", "покерная комната"],
  },
  {
    id: "play_room",
    labelRu: "Игровая",
    aliases: ["play_room", "play room", "playroom", "игровая"],
  },
  {
    id: "kids_room",
    labelRu: "Детская (Василиса)",
    aliases: [
      "kids_room",
      "kid's room",
      "kids room",
      "kidsroom",
      "vasilisa's room",
      "vasilisas room",
      "комната василисы",
      "детская",
      "детская комната",
    ],
  },
  {
    id: "kids_office",
    labelRu: "Детский офис (Василиса)",
    aliases: [
      "kids_office",
      "kid's office",
      "kids office",
      "vasilisa's office",
      "vasilisas office",
      "василисин офис",
      "василисин оффис",
      "детский офис",
    ],
  },
  {
    id: "guest_room",
    labelRu: "Гостевая",
    aliases: ["guest_room", "guest room", "guestroom", "гостевая"],
  },
];

function normalizeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

const ALIAS_TO_ID: Map<string, DeviceRoomId> = (() => {
  const map = new Map<string, DeviceRoomId>();
  for (const room of DEVICE_ROOMS) {
    for (const alias of room.aliases) {
      map.set(normalizeKey(alias), room.id);
    }
  }
  return map;
})();

const LABEL_BY_ID: Record<DeviceRoomId, string> = Object.fromEntries(
  DEVICE_ROOMS.map((r) => [r.id, r.labelRu]),
) as Record<DeviceRoomId, string>;

/** Map id or any alias → stable room id. Empty → undefined. Unknown → null. */
export function normalizeRoom(
  input: string | undefined | null,
): DeviceRoomId | undefined | null {
  if (input == null) return undefined;
  const key = normalizeKey(input);
  if (!key) return undefined;
  return ALIAS_TO_ID.get(key) ?? null;
}

export function roomLabelRu(id: DeviceRoomId): string {
  return LABEL_BY_ID[id];
}

export function isDeviceRoomId(value: string): value is DeviceRoomId {
  return (DEVICE_ROOM_IDS as readonly string[]).includes(value);
}
