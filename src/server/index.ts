import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadConfig, resolveICloudCalendarConfig } from "../config.js";
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
import { EventStore } from "../events/store.js";
import { DeviceStore, toPublic as toDevicePublic } from "../devices/store.js";
import { ThemeStore } from "../themes/store.js";
import { BraveClient } from "../search/brave-client.js";
import { GooglePlacesClient } from "../search/google-places-client.js";
import { ToolGateway } from "../tools/gateway.js";
import { createDeviceTools } from "../tools/device-tools.js";
import { createMemoryTools } from "../tools/memory-tools.js";
import { createPlanTools } from "../tools/plan-tools.js";
import { createReminderTools } from "../tools/reminder-tools.js";
import { createScheduleTools } from "../tools/schedule-tools.js";
import { createSearchTools } from "../tools/search-tools.js";
import { createThemeTools } from "../tools/theme-tools.js";
import { registerAttachmentTools } from "../tools/attachment-tools.js";
import {
  OpenMeteoWeather,
  weatherEnabledFlag,
} from "../weather/open-meteo.js";
import { logger } from "../log.js";
import {
  startTelemetry,
  shutdownTelemetry,
  classifyError,
  getTelemetry,
} from "../telemetry.js";
import { handleAgentSessionClearHttp, handleAgentTurnHttp, readJsonBody } from "./agent-http.js";
import {
  handleInboxAddHttp,
  handleInboxClearHttp,
  handleInboxStatusHttp,
} from "./inbox-http.js";
import { VoiceGateway } from "./voice-gateway.js";
import {
  connectRedisClient,
  RedisAgentSessionStore,
} from "../agent/session-store.js";
import { FsAttachmentStore } from "../attachments/fs-store.js";
import { AttachmentDbStore } from "../attachments/db-store.js";
import { startAttachmentStorageMetrics } from "../attachments/storage-metrics.js";
import type { RedisClientType } from "redis";
import { mkdir } from "node:fs/promises";

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
  const eventStore = new EventStore(prisma);
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
  })) {
    tools.register(tool);
  }
  if (calendarClient) {
    for (const tool of createCalendarTools({
      calendar: calendarClient,
      store: eventStore,
      config,
    })) {
      tools.register(tool);
    }
  }
  for (const tool of createPlanTools({ store: planStore, config })) {
    tools.register(tool);
  }
  for (const tool of createScheduleTools({
    reminders: reminderStore,
    events: eventStore,
    plans: planStore,
    config,
  })) {
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

  await mkdir(config.ATTACHMENTS_DIR, { recursive: true });
  const attachmentStore = new FsAttachmentStore({
    rootDir: config.ATTACHMENTS_DIR,
    maxInboxFiles: config.MAX_INBOX_FILES,
    maxFileBytes: config.MAX_ATTACHMENT_FILE_BYTES,
    maxInboxTotalBytes: config.MAX_INBOX_TOTAL_BYTES,
  });
  const attachmentDb = new AttachmentDbStore(prisma, embedder);
  const agentTurnContext: {
    userId?: string;
    pendingInputFiles?: string[];
  } = {};
  registerAttachmentTools(tools, {
    dbStore: attachmentDb,
    fsStore: attachmentStore,
    apiKey: config.OPENAI_API_KEY,
    getPendingInputFiles: () => agentTurnContext.pendingInputFiles,
    getUserId: () => agentTurnContext.userId,
  });

  let stopStorageMetrics: (() => void) | undefined;
  try {
    const tel = getTelemetry();
    stopStorageMetrics = startAttachmentStorageMetrics({
      store: attachmentStore,
      intervalMs: config.ATTACHMENT_STORAGE_METRIC_INTERVAL_MS,
      createObservableGauge: (name, opts) =>
        (
          tel.meter as unknown as {
            createObservableGauge: (
              n: string,
              o: { description: string },
            ) => {
              addCallback: (
                cb: (result: {
                  observe: (
                    value: number,
                    attrs?: Record<string, string>,
                  ) => void;
                }) => void,
              ) => void;
            };
          }
        ).createObservableGauge(name, opts),
    });
  } catch (err) {
    logger.exception("[core] attachment metrics init failed", err, {
      component: "core",
      handler: "http",
      step: "storage_metric",
      result: "error",
      error_type: classifyError(err),
    });
  }

  const weather = new OpenMeteoWeather({
    enabled: weatherEnabledFlag(config.JARVIS_WEATHER),
    lat: config.JARVIS_WEATHER_LAT,
    lon: config.JARVIS_WEATHER_LON,
    place: config.JARVIS_WEATHER_PLACE,
    timeoutMs: Math.round(config.JARVIS_WEATHER_TIMEOUT * 1000),
  });

  const getInstructions = async () => {
    if (!cachedInstructions) {
      return refreshInstructions();
    }
    return cachedInstructions;
  };

  let redisClient: RedisClientType | null = null;
  try {
    redisClient = await connectRedisClient(config.REDIS_URL);
    logger.info("[core] redis connected", {
      component: "core",
      handler: "http",
      step: "redis",
      result: "success",
    });
  } catch (err) {
    logger.exception("[core] redis connect failed; agent sessions disabled", err, {
      component: "core",
      handler: "http",
      step: "redis",
      result: "error",
      error_type: classifyError(err),
    });
  }

  const sessionStore = redisClient
    ? new RedisAgentSessionStore(redisClient, {
        ttlSeconds: config.AGENT_SESSION_TTL_SECONDS,
        maxMessages: config.AGENT_SESSION_MAX_MESSAGES,
      })
    : undefined;

  const voice = new VoiceGateway({
    config,
    tools,
    deviceRegistry,
    deviceStore,
    reminderStore,
    planStore,
    getInstructions,
  });

  const agentHttpDeps = {
    apiKey: config.OPENAI_API_KEY,
    model: config.AGENT_CHAT_MODEL,
    tools,
    getInstructions,
    tokensEqual,
    gatewayToken: config.JARVIS_GATEWAY_TOKEN,
    extractBearer,
    readJsonBody,
    sessionStore,
    attachmentStore,
    attachmentDb,
    turnContext: agentTurnContext,
  };

  const inboxHttpDeps = {
    store: attachmentStore,
    tokensEqual,
    gatewayToken: config.JARVIS_GATEWAY_TOKEN,
    extractBearer,
    readJsonBody,
    maxFileBytes: config.MAX_ATTACHMENT_FILE_BYTES,
  };

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

    if (url === "/internal/agent/turn" && req.method === "POST") {
      void handleAgentTurnHttp(req, res, agentHttpDeps);
      return;
    }

    if (url === "/internal/agent/session/clear" && req.method === "POST") {
      void handleAgentSessionClearHttp(req, res, agentHttpDeps);
      return;
    }

    if (url === "/internal/inbox/add" && req.method === "POST") {
      void handleInboxAddHttp(req, res, inboxHttpDeps);
      return;
    }

    if (
      (url === "/internal/inbox/status" ||
        url.startsWith("/internal/inbox/status?")) &&
      req.method === "GET"
    ) {
      void handleInboxStatusHttp(req, res, inboxHttpDeps);
      return;
    }

    if (url === "/internal/inbox/clear" && req.method === "POST") {
      void handleInboxClearHttp(req, res, inboxHttpDeps);
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
    stopStorageMetrics?.();
    server.close();
    if (redisClient) {
      await redisClient.quit().catch(() => undefined);
    }
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
