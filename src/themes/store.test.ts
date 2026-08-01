import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ThemeStore } from "./store.js";

const THEME_ID = "11111111-1111-4111-8111-111111111111";
const ENTRY_ID = "22222222-2222-4222-8222-222222222222";

describe("ThemeStore", () => {
  let db: {
    theme: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    themeEntry: {
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
    $executeRawUnsafe: ReturnType<typeof vi.fn>;
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
  };
  let store: ThemeStore;

  beforeEach(() => {
    db = {
      theme: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      themeEntry: {
        create: vi.fn(),
        update: vi.fn(),
        findUnique: vi.fn(),
      },
      $executeRawUnsafe: vi.fn(),
      $queryRawUnsafe: vi.fn(),
    };
    store = new ThemeStore(db as unknown as PrismaClient);
  });

  it("create with first entry", async () => {
    const now = new Date();
    db.theme.create.mockResolvedValue({
      id: THEME_ID,
      kind: "idea",
      title: "стартап",
      status: "active",
      summary: null,
      meta: null,
      rawUtterance: "запомни идею стартап",
      lastTouchedAt: now,
      createdAt: now,
      updatedAt: now,
      entries: [
        {
          id: ENTRY_ID,
          themeId: THEME_ID,
          kind: "note",
          status: "open",
          text: "приложение для X",
          rawUtterance: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });

    const theme = await store.create({
      kind: "idea",
      title: "стартап",
      rawUtterance: "запомни идею стартап",
      firstEntry: { text: "приложение для X" },
    });

    expect(theme.entries).toHaveLength(1);
    expect(theme.title).toBe("стартап");
    expect(db.theme.create).toHaveBeenCalled();
  });

  it("addEntry bumps lastTouchedAt", async () => {
    const now = new Date();
    db.theme.findUnique
      .mockResolvedValueOnce({
        id: THEME_ID,
        kind: "trip",
        title: "Япония",
        status: "active",
        summary: null,
        meta: null,
        rawUtterance: null,
        lastTouchedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .mockResolvedValueOnce({
        id: THEME_ID,
        kind: "trip",
        title: "Япония",
        status: "active",
        summary: null,
        meta: null,
        rawUtterance: null,
        lastTouchedAt: now,
        createdAt: now,
        updatedAt: now,
        entries: [
          {
            id: ENTRY_ID,
            themeId: THEME_ID,
            kind: "note",
            status: "open",
            text: "нужны визы",
            rawUtterance: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
    db.themeEntry.create.mockResolvedValue({
      id: ENTRY_ID,
      themeId: THEME_ID,
      kind: "note",
      status: "open",
      text: "нужны визы",
      rawUtterance: null,
      createdAt: now,
      updatedAt: now,
    });
    db.theme.update.mockResolvedValue({});

    await store.addEntry({ themeId: THEME_ID, text: "нужны визы" });
    expect(db.theme.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: THEME_ID },
        data: expect.objectContaining({ lastTouchedAt: expect.any(Date) }),
      }),
    );
  });

  it("archive sets status archived", async () => {
    const now = new Date();
    db.theme.update.mockResolvedValue({});
    db.theme.findUnique.mockResolvedValue({
      id: THEME_ID,
      kind: "idea",
      title: "x",
      status: "archived",
      summary: null,
      meta: null,
      rawUtterance: null,
      lastTouchedAt: now,
      createdAt: now,
      updatedAt: now,
      entries: [],
    });

    const theme = await store.archive(THEME_ID);
    expect(theme?.status).toBe("archived");
    expect(db.theme.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "archived" }),
      }),
    );
  });

  it("promote idea to project", async () => {
    const now = new Date();
    db.theme.findUnique
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        id: THEME_ID,
        kind: "project",
        title: "стартап",
        status: "active",
        summary: null,
        meta: null,
        rawUtterance: null,
        lastTouchedAt: now,
        createdAt: now,
        updatedAt: now,
        entries: [],
      });
    db.theme.update.mockResolvedValue({});

    const theme = await store.promote(THEME_ID);
    expect(theme?.kind).toBe("project");
    expect(db.theme.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: "project" }),
      }),
    );
  });

  it("keywordSearch matches title", async () => {
    const now = new Date();
    db.theme.findMany.mockResolvedValue([
      {
        id: THEME_ID,
        kind: "trip",
        title: "Поездка в Японию",
        status: "active",
        summary: null,
        meta: null,
        rawUtterance: null,
        lastTouchedAt: now,
        createdAt: now,
        updatedAt: now,
        entries: [],
      },
    ]);

    const hits = await store.keywordSearch("япония");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.title).toContain("Японию");
  });
});
