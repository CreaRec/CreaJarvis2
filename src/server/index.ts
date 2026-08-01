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
import { ToolGateway } from "../tools/gateway.js";
import { createMemoryTools } from "../tools/memory-tools.js";
import { VoiceGateway } from "./voice-gateway.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new MemoryStore(prisma);
  const embedder = new Embedder(config);
  const retriever = createRetriever(config.MEMORY_RETRIEVER, {
    db: prisma,
    store,
    embedder,
  });

  let cachedInstructions: string | null = null;

  const refreshInstructions = async (): Promise<string> => {
    const profile = await buildWarmProfile(store);
    const block = formatWarmProfileBlock(profile);
    cachedInstructions = buildSessionInstructions(block);
    return cachedInstructions;
  };

  const tools = new ToolGateway();
  for (const tool of createMemoryTools({
    store,
    retriever,
    onProfileMaybeChanged: async () => {
      cachedInstructions = null;
    },
  })) {
    tools.register(tool);
  }

  const voice = new VoiceGateway({
    config,
    tools,
    getInstructions: async () => {
      if (!cachedInstructions) {
        return refreshInstructions();
      }
      return cachedInstructions;
    },
  });

  const server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "crea-jarvis2-core" }));
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });

  voice.attach(server);

  server.listen(config.PORT, "0.0.0.0", () => {
    console.log(`[core] listening on :${config.PORT} (health + /voice)`);
  });

  const shutdown = async () => {
    console.log("[core] shutting down");
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
