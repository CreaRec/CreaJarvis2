import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { prisma } from "../src/db/prisma.js";
import { Embedder } from "../src/memory/embedder.js";
import { createRetriever } from "../src/memory/pgvector-retriever.js";
import { hashFactContent, MemoryStore } from "../src/memory/store.js";
import type { MemoryBranch, MemoryConfidence, MemorySensitivity } from "../src/memory/types.js";

interface ParsedFact {
  branch: MemoryBranch;
  topic: string;
  text: string;
  confidence: MemoryConfidence;
  sensitivity: MemorySensitivity;
  source: string;
}

const PRIVATE_SECTION_RE =
  /финанс|налог|здоров|ипотек|credit|mortgage|медицин|спин/i;

function classifySection(
  heading: string,
): { branch: MemoryBranch; confidence: MemoryConfidence; sensitivity: MemorySensitivity } {
  const h = heading.toLowerCase();
  if (/предпочтения|ответ|23\./.test(h) || h.includes("предпочтения в ответах")) {
    return { branch: "directives", confidence: "high", sensitivity: "normal" };
  }
  if (/предположен|25\./.test(h)) {
    return { branch: "user", confidence: "assumption", sensitivity: "normal" };
  }
  if (/высокой уверен|26\./.test(h) || /машиночитаем|30\./.test(h)) {
    return { branch: "user", confidence: "high", sensitivity: "normal" };
  }
  if (/мир|world|погода|новост/.test(h)) {
    return { branch: "world", confidence: "medium", sensitivity: "normal" };
  }
  const sensitivity: MemorySensitivity = PRIVATE_SECTION_RE.test(heading)
    ? "private"
    : "normal";
  return { branch: "user", confidence: "medium", sensitivity };
}

function parseExport(markdown: string): ParsedFact[] {
  const lines = markdown.split(/\r?\n/);
  const facts: ParsedFact[] = [];
  let heading = "root";
  let meta = classifySection(heading);

  const pushBullet = (text: string) => {
    const cleaned = text.replace(/^[-*]\s+/, "").replace(/\*\*/g, "").trim();
    if (cleaned.length < 3) return;
    if (cleaned.startsWith("```")) return;
    facts.push({
      branch: meta.branch,
      topic: heading.replace(/^#+\s*/, "").slice(0, 120),
      text: cleaned,
      confidence: meta.confidence,
      sensitivity: meta.sensitivity,
      source: `chatgpt-export:${heading.slice(0, 80)}`,
    });
  };

  let inYaml = false;
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inYaml = !inYaml;
      continue;
    }
    if (inYaml) {
      const m = line.match(/^\s{0,4}([a-zA-Z0-9_]+):\s*(.+)$/);
      if (m && m[2] && !m[2].startsWith("|") && m[2] !== "") {
        pushBullet(`${m[1]}: ${m[2].replace(/^["']|["']$/g, "")}`);
      }
      continue;
    }
    if (line.startsWith("#")) {
      heading = line.replace(/^#+\s*/, "").trim();
      meta = classifySection(heading);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      pushBullet(line.trim());
    }
  }
  return facts;
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npm run memory:import -- /path/to/export.md");
    process.exit(1);
  }

  const config = loadConfig();
  const store = new MemoryStore(prisma);
  const embedder = new Embedder(config);
  const retriever = createRetriever(config.MEMORY_RETRIEVER, {
    db: prisma,
    store,
    embedder,
  });

  const markdown = readFileSync(resolve(file), "utf8");
  const parsed = parseExport(markdown);
  console.log(`[import] parsed ${parsed.length} facts from ${file}`);

  const batchSize = 32;
  let saved = 0;
  for (let i = 0; i < parsed.length; i += batchSize) {
    const batch = parsed.slice(i, i + batchSize);
    const embeddings = await embedder.embedMany(
      batch.map((f) => `${f.topic}\n${f.text}`),
    );
    for (let j = 0; j < batch.length; j++) {
      const fact = batch[j]!;
      const contentHash = hashFactContent(fact.source, fact.text);
      const row = await store.save({ ...fact, contentHash });
      await store.updateEmbedding(row.id, embeddings[j]!);
      saved += 1;
    }
    console.log(`[import] ${saved}/${parsed.length}`);
  }

  await store.setMeta("last_import_at", new Date().toISOString());
  await store.setMeta("last_import_file", file);
  // ensure retriever.index path works (embeddings already set)
  void retriever;
  console.log(`[import] done: ${saved} facts`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[import] failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
