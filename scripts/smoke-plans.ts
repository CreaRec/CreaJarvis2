/**
 * Smoke: set/add/get/complete/carry_over day plans against local DB.
 */
import { loadConfig } from "../src/config.js";
import { prisma } from "../src/db/prisma.js";
import { Embedder } from "../src/memory/embedder.js";
import { PlanStore } from "../src/plans/store.js";
import { ReminderStore } from "../src/reminders/store.js";
import { ToolGateway } from "../src/tools/gateway.js";
import { createPlanTools } from "../src/tools/plan-tools.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const reminders = new ReminderStore(prisma, new Embedder(config));
  const store = new PlanStore(
    prisma,
    reminders,
    config.USER_TIMEZONE,
    new Embedder(config),
  );
  const tools = new ToolGateway();
  for (const t of createPlanTools({ store, config })) {
    tools.register(t);
  }

  const date = "2099-01-15";
  const set = await tools.execute("plan_set", {
    date,
    items: [
      { text: "smoke: morning", raw_utterance: "план smoke" },
      {
        text: "smoke: timed",
        scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
      },
    ],
  });
  console.log("set:", JSON.stringify(set, null, 2));
  if (!set.ok) process.exit(1);

  const added = await tools.execute("plan_add", {
    date,
    items: [{ text: "smoke: extra" }],
  });
  console.log("add ok:", added.ok);

  const got = await tools.execute("plan_get", { date });
  console.log("get:", JSON.stringify(got, null, 2));

  const items =
    (got.ok &&
      (got.data as { items?: Array<{ id: string; text: string }> }).items) ||
    [];
  const first = items.find((i) => i.text.includes("morning"));
  if (first) {
    const done = await tools.execute("plan_complete_item", { id: first.id });
    console.log("complete:", done.ok);
  }

  const carry = await tools.execute("plan_carry_over", {
    from_date: date,
    to_date: "2099-01-16",
  });
  console.log("carry:", JSON.stringify(carry, null, 2));

  await tools.execute("plan_clear", { date, only_open: false });
  await tools.execute("plan_clear", {
    date: "2099-01-16",
    only_open: false,
  });

  const debug = await store.listForDebug(5);
  console.log(
    "debug sample:",
    debug.slice(0, 2).map((i) => ({ date: i.localDate, text: i.text })),
  );

  await prisma.$disconnect();
  console.log("ok");
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
