/**
 * Smoke: create a near-future reminder, list, cancel.
 * Requires core DB (compose up) and env from .env / DATABASE_URL.
 */
import { loadConfig } from "../src/config.js";
import { prisma } from "../src/db/prisma.js";
import { Embedder } from "../src/memory/embedder.js";
import { ReminderStore, toPublic } from "../src/reminders/store.js";
import { ToolGateway } from "../src/tools/gateway.js";
import { createReminderTools } from "../src/tools/reminder-tools.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new ReminderStore(prisma, new Embedder(config));
  const tools = new ToolGateway();
  for (const t of createReminderTools({ store, config })) {
    tools.register(t);
  }

  const fireAt = new Date(Date.now() + 2 * 60_000).toISOString();
  const created = await tools.execute("reminder_create", {
    text: "smoke: check reminders",
    fire_at: fireAt,
    raw_utterance: "напомни через 2 минуты smoke",
  });
  console.log("create:", JSON.stringify(created, null, 2));
  if (!created.ok) process.exit(1);

  const id = (created.data as { id: string }).id;

  const listed = await tools.execute("reminder_list", {});
  console.log("list count:", (listed as { data?: { count?: number } }).data?.count);

  const searched = await tools.execute("reminder_search", { query: "smoke" });
  console.log("search:", JSON.stringify(searched, null, 2));

  const cancelled = await tools.execute("reminder_cancel", { id });
  console.log("cancel:", JSON.stringify(cancelled, null, 2));

  const debug = await store.listForDebug(10);
  console.log(
    "debug sample:",
    debug.slice(0, 3).map((r) => toPublic(r)),
  );

  await prisma.$disconnect();
  console.log("ok");
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
