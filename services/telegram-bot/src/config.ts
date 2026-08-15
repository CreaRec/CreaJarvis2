import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  JARVIS_GATEWAY_TOKEN: z.string().min(8),
  JARVIS_BASE_URL: z.string().default("http://core:8787"),
  USERS_PATH: z.string().default("data/users.json"),
  STT_MODEL: z.string().default("whisper-1"),
  TTS_MODEL: z.string().default("gpt-4o-mini-tts"),
  TTS_VOICE: z.string().default("marin"),
  MAX_VOICE_BYTES: z.coerce.number().int().positive().default(20_971_520),
  MAX_VOICE_DURATION_SEC: z.coerce.number().int().positive().default(120),
});

export type BotConfig = z.infer<typeof envSchema>;

export function loadBotConfig(
  overrides: Partial<Record<keyof BotConfig, unknown>> = {},
): BotConfig {
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid bot config: ${msg}`);
  }
  return parsed.data;
}
