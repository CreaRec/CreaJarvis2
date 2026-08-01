/**
 * Smoke: create/list/get/add_entry/promote/archive themes against local DB.
 */
import { loadConfig } from "../src/config.js";
import { prisma } from "../src/db/prisma.js";
import { Embedder } from "../src/memory/embedder.js";
import { ThemeStore } from "../src/themes/store.js";
import { ToolGateway } from "../src/tools/gateway.js";
import { createThemeTools } from "../src/tools/theme-tools.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new ThemeStore(prisma, new Embedder(config));
  const tools = new ToolGateway();
  for (const t of createThemeTools({ store })) {
    tools.register(t);
  }

  const created = await tools.execute("theme_create", {
    kind: "trip",
    title: "smoke: Япония",
    meta: { destination: "Tokyo" },
    raw_utterance: "поездка в Японию smoke",
    first_entry: { text: "нужен JR Pass", kind: "checklist" },
  });
  console.log("create:", JSON.stringify(created, null, 2));
  if (!created.ok) process.exit(1);

  const id = (created.data as { id: string }).id;

  const listed = await tools.execute("theme_list", { kind: "trip" });
  console.log("list count:", (listed as { data?: { count?: number } }).data?.count);

  const added = await tools.execute("theme_add_entry", {
    theme_id: id,
    text: "бюджет ~3000$",
    kind: "note",
  });
  console.log("add_entry:", added.ok);

  const packing = await tools.execute("theme_add_entries", {
    theme_id: id,
    items: [{ text: "паспорт" }, { text: "адаптер" }],
  });
  console.log("add_entries packing:", packing.ok);

  const got = await tools.execute("theme_get", { id });
  console.log("get entries:", (got as { data?: { entries?: unknown[] } }).data?.entries?.length);

  const shopping = await tools.execute("theme_create", {
    kind: "list",
    title: "smoke: Costco",
    first_entry: { text: "молоко" },
  });
  console.log("list create:", shopping.ok);
  if (shopping.ok) {
    const listId = (shopping.data as { id: string }).id;
    const bulk = await tools.execute("theme_add_entries", {
      theme_id: listId,
      items: [{ text: "яйца" }, { text: "хлеб" }],
    });
    console.log("list add_entries:", bulk.ok);
    await tools.execute("theme_archive", { id: listId });
  }

  const idea = await tools.execute("theme_create", {
    kind: "idea",
    title: "smoke: идея",
    first_entry: { text: "что-то" },
  });
  if (idea.ok) {
    const ideaId = (idea.data as { id: string }).id;
    const promoted = await tools.execute("theme_promote", { id: ideaId });
    console.log("promote:", promoted.ok);
    await tools.execute("theme_archive", { id: ideaId });
  }

  await tools.execute("theme_archive", { id });

  const debug = await store.listForDebug(5);
  console.log("debug sample:", debug.slice(0, 2));

  await prisma.$disconnect();
  console.log("ok");
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
