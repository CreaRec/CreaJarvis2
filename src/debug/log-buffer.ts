import { format } from "node:util";

export type LogLevel = "log" | "info" | "warn" | "error" | "debug";

export type LogEntry = {
  id: number;
  ts: string;
  level: LogLevel;
  message: string;
};

const LEVELS: LogLevel[] = ["log", "info", "warn", "error", "debug"];

export class LogBuffer {
  private entries: LogEntry[] = [];
  private nextId = 1;

  constructor(private readonly maxSize = 500) {
    if (maxSize < 1) {
      throw new Error("LogBuffer maxSize must be >= 1");
    }
  }

  append(level: LogLevel, message: string, ts: Date = new Date()): LogEntry {
    const entry: LogEntry = {
      id: this.nextId++,
      ts: ts.toISOString(),
      level,
      message,
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxSize) {
      this.entries.splice(0, this.entries.length - this.maxSize);
    }
    return entry;
  }

  list(opts: { afterId?: number; limit?: number } = {}): LogEntry[] {
    const afterId = opts.afterId ?? 0;
    let rows = this.entries.filter((e) => e.id > afterId);
    if (opts.limit != null && opts.limit >= 0) {
      rows = rows.slice(-opts.limit);
    }
    return rows;
  }

  clear(): void {
    this.entries = [];
  }

  get size(): number {
    return this.entries.length;
  }
}

/** Shared process-wide buffer for /debug/logs. */
export const debugLogBuffer = new LogBuffer(500);

type ConsoleMethod = (...args: unknown[]) => void;

/**
 * Mirror console.log/info/warn/error/debug into the buffer while keeping
 * original console output. Returns a restore function.
 */
export function installConsoleCapture(
  buffer: LogBuffer = debugLogBuffer,
): () => void {
  const originals = new Map<LogLevel, ConsoleMethod>();

  for (const level of LEVELS) {
    const original = console[level].bind(console) as ConsoleMethod;
    originals.set(level, original);
    console[level] = (...args: unknown[]) => {
      try {
        buffer.append(level, format(...args));
      } catch {
        // never break console
      }
      original(...args);
    };
  }

  return () => {
    for (const level of LEVELS) {
      const original = originals.get(level);
      if (original) console[level] = original;
    }
  };
}
