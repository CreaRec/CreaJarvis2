import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadConfig } from "../config.js";
import {
  debugLogBuffer,
  installConsoleCapture,
} from "../debug/log-buffer.js";
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
import { DeviceRegistry } from "../reminders/device-registry.js";
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

installConsoleCapture(debugLogBuffer);

function applyCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization",
  );
}

function parseAfterId(url: string): number {
  try {
    const q = new URL(url, "http://localhost").searchParams.get("after_id");
    if (q == null || q === "") return 0;
    const n = Number(q);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function extractBearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1]?.trim() || null;
}

function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function requireDebugAuth(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
): boolean {
  applyCors(res);
  const provided = extractBearer(req);
  if (!provided || !tokensEqual(provided, token)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
    return false;
  }
  return true;
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
  const deviceRegistry = new DeviceRegistry();
  const poller = new ReminderPoller(reminderStore, deviceRegistry, config);

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
    deviceRegistry,
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
      if (!requireDebugAuth(req, res, config.JARVIS_GATEWAY_TOKEN)) return;
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
      if (!requireDebugAuth(req, res, config.JARVIS_GATEWAY_TOKEN)) return;
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
      if (!requireDebugAuth(req, res, config.JARVIS_GATEWAY_TOKEN)) return;
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

    if (
      (url === "/debug/logs" || url.startsWith("/debug/logs?")) &&
      req.method === "GET"
    ) {
      if (!requireDebugAuth(req, res, config.JARVIS_GATEWAY_TOKEN)) return;
      const afterId = parseAfterId(url);
      const entries = debugLogBuffer.list({ afterId, limit: 500 });
      applyCors(res);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          entries,
          count: entries.length,
        }),
      );
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
