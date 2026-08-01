import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  DATABASE_URL: z
    .string()
    .default("postgres://jarvis:jarvis@postgres:5432/jarvis"),
  PORT: z.coerce.number().default(8787),
  MEMORY_RETRIEVER: z.enum(["pgvector", "qdrant"]).default("pgvector"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDING_DIMENSIONS: z.coerce.number().default(1536),
  REALTIME_MODEL: z.string().default("gpt-realtime-2.1"),
  VOICE: z.string().default("marin"),
  VOICE_GATEWAY_URL: z.string().default("ws://127.0.0.1:8787/voice"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(
  overrides: Partial<Record<keyof AppConfig, unknown>> = {},
): AppConfig {
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid config: ${msg}`);
  }
  return parsed.data;
}
