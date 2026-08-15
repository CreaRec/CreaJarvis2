import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  loadConfig,
  resolveICloudCalendarConfig,
  resolveTelegramConfig,
} from "../config.js";
import { TsdavICloudCalendarClient } from "../calendar/icloud-client.js";
import { createCalendarTools } from "../tools/calendar-tools.js";
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
import { DeviceStore, toPublic as toDevicePublic } from "../devices/store.js";
import { ThemeStore } from "../themes/store.js";
import { BraveClient } from "../search/brave-client.js";
import { GooglePlacesClient } from "../search/google-places-client.js";
import { ToolGateway } from "../tools/gateway.js";
import { createDeviceTools } from "../tools/device-tools.js";
import { createMemoryTools } from "../tools/memory-tools.js";
import { createPlanTools } from "../tools/plan-tools.js";
import { createReminderTools } from "../tools/reminder-tools.js";
import { createSearchTools } from "../tools/search-tools.js";
import { createThemeTools } from "../tools/theme-tools.js";
import {
  OpenMeteoWeather,
  weatherEnabledFlag,
} from "../weather/open-meteo.js";
import { logger } from "../log.js";
import { startTelemetry, shutdownTelemetry } from "../telemetry.js";
import { TelegramBotService } from "../telegram/bot.js";
import { TelegramSettingsStore } from "../telegram/settings-store.js";
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
  startTelemetry();
  const config = loadConfig();
  const telegram = resolveTelegramConfig(config);
  const iCloud = resolveICloudCalendarConfig(config);
  const calendarClient = iCloud.enabled
    ? new TsdavICloudCalendarClient(
        iCloud.username,
        iCloud.password,
        iCloud.calendarUrl,
      )
    : null;
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
  const deviceStore = new DeviceStore(prisma);
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
      calendarEnabled: iCloud.enabled,
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
  const places = new GooglePlacesClient(
    config.GOOGLE_PLACES_API_KEY,
    config.BRAVE_SEARCH_LANG,
  );
  for (const tool of createSearchTools({ brave, places })) {
    tools.register(tool);
  }
  for (const tool of createReminderTools({
    store: reminderStore,
    config,
    calendarEnabled: iCloud.enabled,
    calendar: calendarClient,
  })) {
    tools.register(tool);
  }
  if (calendarClient) {
    for (const tool of createCalendarTools({
      calendar: calendarClient,
      store: reminderStore,
      config,
    })) {
      tools.register(tool);
    }
  }
  for (const tool of createPlanTools({ store: planStore, config })) {
    tools.register(tool);
  }
  for (const tool of createThemeTools({ store: themeStore })) {
    tools.register(tool);
  }
  for (const tool of createDeviceTools({
    store: deviceStore,
    registry: deviceRegistry,
  })) {
    tools.register(tool);
  }

  const weather = new OpenMeteoWeather({
    enabled: weatherEnabledFlag(config.JARVIS_WEATHER),
    lat: config.JARVIS_WEATHER_LAT,
    lon: config.JARVIS_WEATHER_LON,
    place: config.JARVIS_WEATHER_PLACE,
    timeoutMs: Math.round(config.JARVIS_WEATHER_TIMEOUT * 1000),
  });

  const voice = new VoiceGateway({
    config,
    tools,
    deviceRegistry,
    deviceStore,
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

    if (
      req.method === "OPTIONS" &&
      (url.startsWith("/debug") || url.startsWith("/weather"))
    ) {
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

    if (
      (url === "/weather/current" || url.startsWith("/weather/current?")) &&
      req.method === "GET"
    ) {
      if (!requireDebugAuth(req, res, config.JARVIS_GATEWAY_TOKEN)) return;
      void (async () => {
        try {
          const snap = await weather.current();
          applyCors(res);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, weather: snap }));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          applyCors(res);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: message }));
        }
      })();
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

    if (url === "/debug/devices" && req.method === "GET") {
      if (!requireDebugAuth(req, res, config.JARVIS_GATEWAY_TOKEN)) return;
      void (async () => {
        try {
          const rows = await deviceStore.listForDebug(100);
          const online = deviceRegistry.onlineIds();
          applyCors(res);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              devices: rows.map((d) =>
                toDevicePublic(d, { online: online.has(d.id) }),
              ),
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

  let telegramBot: TelegramBotService | null = null;
  if (telegram.enabled) {
    const telegramSettings = new TelegramSettingsStore(prisma);
    telegramBot = new TelegramBotService({
      telegram,
      openaiApiKey: config.OPENAI_API_KEY,
      tools,
      settings: telegramSettings,
      getInstructions: async () => {
        if (!cachedInstructions) {
          return refreshInstructions();
        }
        return cachedInstructions;
      },
    });
    await telegramBot.start();
  } else {
    logger.info("[telegram] disabled (no TELEGRAM_BOT_TOKEN)", {
      component: "telegram",
      handler: "telegram",
      step: "start",
      result: "skipped",
    });
  }

  server.listen(config.PORT, "0.0.0.0", () => {
    logger.info("[core] listening", {
      component: "core",
      handler: "http",
      step: "start",
      port: config.PORT,
    });
  });

  const shutdown = async () => {
    logger.info("[core] shutting down", {
      component: "core",
      handler: "http",
      step: "finish",
    });
    poller.stop();
    if (telegramBot) {
      await telegramBot.stop("shutdown");
    }
    server.close();
    await prisma.$disconnect();
    await shutdownTelemetry();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  logger.exception("[core] fatal", err, {
    component: "core",
    handler: "http",
    result: "error",
  });
  void shutdownTelemetry().finally(() => process.exit(1));
});
