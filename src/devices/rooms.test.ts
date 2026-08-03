import { describe, expect, it } from "vitest";
import {
  normalizeRoom,
  roomLabelRu,
  DEVICE_ROOM_IDS,
} from "./rooms.js";

describe("normalizeRoom", () => {
  it("maps ids and aliases", () => {
    expect(normalizeRoom("office")).toBe("office");
    expect(normalizeRoom("Офис")).toBe("office");
    expect(normalizeRoom("кабинет")).toBe("office");
    expect(normalizeRoom("Kitchen")).toBe("kitchen_living");
    expect(normalizeRoom("living room")).toBe("kitchen_living");
    expect(normalizeRoom("Kid's room")).toBe("kids_room");
    expect(normalizeRoom("василисин оффис")).toBe("kids_office");
    expect(normalizeRoom("master_bedroom")).toBe("master_bedroom");
  });

  it("returns undefined for empty and null for unknown", () => {
    expect(normalizeRoom(undefined)).toBeUndefined();
    expect(normalizeRoom("  ")).toBeUndefined();
    expect(normalizeRoom("basement")).toBeNull();
  });

  it("has labels for every id", () => {
    for (const id of DEVICE_ROOM_IDS) {
      expect(roomLabelRu(id).length).toBeGreaterThan(0);
    }
  });
});
