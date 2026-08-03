import { describe, expect, it, vi } from "vitest";
import type { ThemeRecord } from "../themes/types.js";
import type { ThemeStore } from "../themes/store.js";
import { ToolGateway } from "./gateway.js";
import { createThemeTools } from "./theme-tools.js";

const THEME_ID = "00000000-0000-4000-8000-000000000001";

function makeTheme(overrides: Partial<ThemeRecord> = {}): ThemeRecord {
  const now = new Date();
  return {
    id: THEME_ID,
    kind: "idea",
    title: "стартап",
    status: "active",
    summary: null,
    meta: null,
    rawUtterance: null,
    lastTouchedAt: now,
    createdAt: now,
    updatedAt: now,
    entries: [],
    ...overrides,
  };
}

function makeStore(
  overrides: Partial<Record<keyof ThemeStore, unknown>> = {},
): ThemeStore {
  return {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    search: vi.fn(),
    addEntry: vi.fn(),
    addEntries: vi.fn(),
    updateTheme: vi.fn(),
    updateEntry: vi.fn(),
    promote: vi.fn(),
    archive: vi.fn(),
    ...overrides,
  } as unknown as ThemeStore;
}

function gatewayWith(store: ThemeStore): ToolGateway {
  const gw = new ToolGateway();
  for (const tool of createThemeTools({ store })) {
    gw.register(tool);
  }
  return gw;
}

describe("createThemeTools", () => {
  it("theme_create happy path", async () => {
    const store = makeStore({
      create: vi.fn().mockResolvedValue(makeTheme()),
    });
    const gw = gatewayWith(store);
    const result = await gw.execute("theme_create", {
      kind: "idea",
      title: "стартап",
      first_entry: { text: "приложение" },
    });
    expect(result.ok).toBe(true);
    expect(store.create).toHaveBeenCalled();
  });

  it("theme_create rejects invalid kind", async () => {
    const store = makeStore();
    const gw = gatewayWith(store);
    const result = await gw.execute("theme_create", {
      kind: "hobby",
      title: "x",
    });
    expect(result.ok).toBe(false);
    expect(store.create).not.toHaveBeenCalled();
  });

  it("theme_list", async () => {
    const store = makeStore({
      list: vi.fn().mockResolvedValue([makeTheme()]),
    });
    const gw = gatewayWith(store);
    const result = await gw.execute("theme_list", {});
    expect(result.ok).toBe(true);
  });

  it("theme_get by id", async () => {
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(makeTheme()),
    });
    const gw = gatewayWith(store);
    const result = await gw.execute("theme_get", { id: THEME_ID });
    expect(result.ok).toBe(true);
  });

  it("theme_get ambiguous query returns candidates", async () => {
    const store = makeStore({
      search: vi.fn().mockResolvedValue([
        makeTheme({ id: THEME_ID, title: "Япония 1" }),
        makeTheme({
          id: "00000000-0000-4000-8000-000000000002",
          title: "Япония 2",
        }),
      ]),
    });
    const gw = gatewayWith(store);
    const result = await gw.execute("theme_get", { query: "япония" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (result.data as { need_clarification?: boolean }).need_clarification,
      ).toBe(true);
    }
  });

  it("theme_create kind=list", async () => {
    const store = makeStore({
      create: vi.fn().mockResolvedValue(makeTheme({ kind: "list", title: "Costco" })),
    });
    const gw = gatewayWith(store);
    const result = await gw.execute("theme_create", {
      kind: "list",
      title: "Costco",
      first_entry: { text: "молоко" },
    });
    expect(result.ok).toBe(true);
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "list",
        firstEntry: expect.objectContaining({ kind: "checklist" }),
      }),
    );
  });

  it("theme_add_entries defaults kind to checklist", async () => {
    const store = makeStore({
      addEntries: vi.fn().mockResolvedValue(makeTheme({ kind: "list" })),
    });
    const gw = gatewayWith(store);
    const result = await gw.execute("theme_add_entries", {
      theme_id: THEME_ID,
      items: [{ text: "молоко" }, { text: "яйца" }],
    });
    expect(result.ok).toBe(true);
    expect(store.addEntries).toHaveBeenCalledWith(THEME_ID, [
      expect.objectContaining({ text: "молоко", kind: "checklist" }),
      expect.objectContaining({ text: "яйца", kind: "checklist" }),
    ]);
  });

  it("theme_add_entries ambiguous query returns candidates", async () => {
    const store = makeStore({
      search: vi.fn().mockResolvedValue([
        makeTheme({ id: THEME_ID, title: "Costco" }),
        makeTheme({
          id: "00000000-0000-4000-8000-000000000002",
          title: "Costco 2",
        }),
      ]),
      addEntries: vi.fn(),
    });
    const gw = gatewayWith(store);
    const result = await gw.execute("theme_add_entries", {
      query: "costco",
      items: [{ text: "хлеб" }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (result.data as { need_clarification?: boolean }).need_clarification,
      ).toBe(true);
    }
    expect(store.addEntries).not.toHaveBeenCalled();
  });

  it("theme_promote", async () => {
    const store = makeStore({
      promote: vi.fn().mockResolvedValue(makeTheme({ kind: "project" })),
    });
    const gw = gatewayWith(store);
    const result = await gw.execute("theme_promote", { id: THEME_ID });
    expect(result.ok).toBe(true);
  });

  it("theme_archive", async () => {
    const store = makeStore({
      archive: vi.fn().mockResolvedValue(makeTheme({ status: "archived" })),
    });
    const gw = gatewayWith(store);
    const result = await gw.execute("theme_archive", { id: THEME_ID });
    expect(result.ok).toBe(true);
  });

  it("theme tool descriptions prefer themes over memory for trips", () => {
    const gw = gatewayWith(makeStore());
    const byName = Object.fromEntries(
      gw.listRealtimeTools().map((t) => [t.name, t.description]),
    );
    expect(byName.theme_list).toMatch(/какие поездки|kind=trip/i);
    expect(byName.theme_list).toMatch(/memory_search/);
    expect(byName.theme_search).toMatch(/поездка|kind=trip/i);
    expect(byName.theme_search).toMatch(/memory_search/);
    expect(byName.theme_get).toMatch(/trip dates|Майами/i);
    expect(byName.theme_get).toMatch(/memory_search/);
  });
});
