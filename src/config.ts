import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const optionalFloat = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}, z.number().optional());

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
  JARVIS_GATEWAY_TOKEN: z.string().min(8),
  BRAVE_API_KEY: z.string().min(1),
  BRAVE_COUNTRY: z.string().default("US"),
  BRAVE_SEARCH_LANG: z.string().default("ru"),
  USER_TIMEZONE: z.string().default("America/Chicago"),
  REMINDER_MORNING_HOUR: z.coerce.number().int().min(0).max(23).default(10),
  REMINDER_AFTERNOON_HOUR: z.coerce.number().int().min(0).max(23).default(14),
  REMINDER_EVENING_HOUR: z.coerce.number().int().min(0).max(23).default(18),
  REMINDER_NIGHT_HOUR: z.coerce.number().int().min(0).max(23).default(21),
  REMINDER_QUIET_START: z.coerce.number().int().min(0).max(23).default(22),
  REMINDER_QUIET_END: z.coerce.number().int().min(0).max(23).default(8),
  REMINDER_POLL_MS: z.coerce.number().int().min(1000).default(15000),
  /** `0` / `stub` / `off` disables live Open-Meteo (returns stub payload). */
  JARVIS_WEATHER: z.string().default("1"),
  JARVIS_WEATHER_LAT: optionalFloat,
  JARVIS_WEATHER_LON: optionalFloat,
  JARVIS_WEATHER_PLACE: z.string().default(""),
  JARVIS_WEATHER_TIMEOUT: z.coerce.number().positive().default(3),
  /** Apple ID email for iCloud CalDAV (all three ICLOUD_* must be set together). */
  ICLOUD_CALDAV_USERNAME: z.string().default(""),
  ICLOUD_CALDAV_PASSWORD: z.string().default(""),
  ICLOUD_CALDAV_CALENDAR_URL: z.string().default(""),
});

export type AppConfig = z.infer<typeof envSchema>;

export type ICloudCalendarConfig =
  | { enabled: false }
  | {
      enabled: true;
      username: string;
      password: string;
      calendarUrl: string;
    };

/** All empty → disabled; all set → enabled; partial → throws. */
export function resolveICloudCalendarConfig(
  config: AppConfig,
): ICloudCalendarConfig {
  const username = config.ICLOUD_CALDAV_USERNAME.trim();
  const password = config.ICLOUD_CALDAV_PASSWORD.trim();
  const calendarUrl = config.ICLOUD_CALDAV_CALENDAR_URL.trim();
  const set = [username, password, calendarUrl].filter((v) => v.length > 0);
  if (set.length === 0) return { enabled: false };
  if (set.length !== 3) {
    throw new Error(
      "Partial ICLOUD_CALDAV_* config: set USERNAME, PASSWORD, and CALENDAR_URL together, or leave all empty",
    );
  }
  return { enabled: true, username, password, calendarUrl };
}

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
