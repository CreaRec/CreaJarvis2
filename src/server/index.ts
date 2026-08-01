import { createServer } from "node:http";
import { loadConfig } from "../config.js";
import { prisma } from "../db/prisma.js";
import { Embedder } from "../memory/embedder.js";
import { createRetriever } from "../memory/pgvector-retriever.js";
import { MemoryStore } from "../memory/store.js";
import {
  buildSessionInstructions,
  buildWarmProfile,
  formatWarmProfileBlock,
} from "../memory/warm-profile.js";
import { PlanStore, toItemPublic } from "../plans/store.js";
import { ClientRegistry } from "../reminders/client-registry.js";
import { ReminderPoller } from "../reminders/poller.js";
import { ReminderStore, toPublic } from "../reminders/store.js";
import { ThemeStore } from "../themes/store.js";
import { BraveClient } from "../search/brave-client.js";
import { ToolGateway } from "../tools/gateway.js";
import { createMemoryTools } from "../tools/memory-tools.js";
import { createPlanTools } from "../tools/plan-tools.js";
import { createReminderTools } from "../tools/reminder-tools.js";
import { createSearchTools } from "../tools/search-tools.js";
import { createThemeTools } from "../tools/theme-tools.js";
import { VoiceGateway } from "./voice-gateway.js";

function applyCors(res: import("node:http").ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new MemoryStore(prisma);
  const embedder = new Embedder(config);
  const retriever = createRetriever(config.MEMORY_RETRIEVER, {
    db: prisma,
    store,
    embedder,
  });
  const reminderStore = new ReminderStore(prisma, embedder);
  const planStore = new PlanStore(
    prisma,
    reminderStore,
    config.USER_TIMEZONE,
    embedder,
  );
  const themeStore = new ThemeStore(prisma, embedder);
  const clientRegistry = new ClientRegistry();
  const poller = new ReminderPoller(reminderStore, clientRegistry, config);

  let cachedInstructions: string | null = null;

  const refreshInstructions = async (): Promise<string> => {
    const profile = await buildWarmProfile(store);
    const block = formatWarmProfileBlock(profile);
    cachedInstructions = buildSessionInstructions(block, {
      morningHour: config.REMINDER_MORNING_HOUR,
      afternoonHour: config.REMINDER_AFTERNOON_HOUR,
      eveningHour: config.REMINDER_EVENING_HOUR,
      nightHour: config.REMINDER_NIGHT_HOUR,
      timeZone: config.USER_TIMEZONE,
    });
    return cachedInstructions;
  };

  const tools = new ToolGateway();
  for (const tool of createMemoryTools({
    store,
    retriever,
    defaultTimeZone: config.USER_TIMEZONE,
    onProfileMaybeChanged: async () => {
      cachedInstructions = null;
    },
  })) {
    tools.register(tool);
  }

  const brave = new BraveClient(
    config.BRAVE_API_KEY,
    config.BRAVE_COUNTRY,
    config.BRAVE_SEARCH_LANG,
  );
  for (const tool of createSearchTools(brave)) {
    tools.register(tool);
  }
  for (const tool of createReminderTools({ store: reminderStore, config })) {
    tools.register(tool);
  }
  for (const tool of createPlanTools({ store: planStore, config })) {
    tools.register(tool);
  }
  for (const tool of createThemeTools({ store: themeStore })) {
    tools.register(tool);
  }

  const voice = new VoiceGateway({
    config,
    tools,
    clientRegistry,
    reminderStore,
    planStore,
    getInstructions: async () => {
      if (!cachedInstructions) {
        return refreshInstructions();
      }
      return cachedInstructions;
    },
  });

  const server = createServer((req, res) => {
    const url = req.url ?? "/";

    if (req.method === "OPTIONS" && url.startsWith("/debug")) {
      applyCors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    if (url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "crea-jarvis2-core" }));
      return;
    }

    if (url === "/debug/reminders" && req.method === "GET") {
      void (async () => {
        try {
          const rows = await reminderStore.listForDebug(100);
          applyCors(res);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              reminders: rows.map(toPublic),
              count: rows.length,
            }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          applyCors(res);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: message }));
        }
      })();
      return;
    }

    if (url === "/debug/plans" && req.method === "GET") {
      void (async () => {
        try {
          const items = await planStore.listForDebug(100);
          applyCors(res);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              items: items.map((i) => ({
                ...toItemPublic(i),
                date: i.localDate,
              })),
              count: items.length,
            }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          applyCors(res);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: message }));
        }
      })();
      return;
    }

    if (url === "/debug/themes" && req.method === "GET") {
      void (async () => {
        try {
          const rows = await themeStore.listForDebug(100);
          applyCors(res);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              rows,
              count: rows.length,
            }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          applyCors(res);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: message }));
        }
      })();
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  voice.attach(server);
  poller.start();

  server.listen(config.PORT, "0.0.0.0", () => {
    console.log(`[core] listening on :${config.PORT} (health + /voice + /debug)`);
  });

  const shutdown = async () => {
    console.log("[core] shutting down");
    poller.stop();
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error("[core] fatal:", err);
  process.exit(1);
});
