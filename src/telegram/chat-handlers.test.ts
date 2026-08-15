import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const otel = vi.hoisted(() => {
  const sessionsTotal = { add: vi.fn() };
  const sessionDuration = { record: vi.fn() };
  const errorsTotal = { add: vi.fn() };
  return {
    sessionsTotal,
    sessionDuration,
    errorsTotal,
    initTelemetry: vi.fn(() => ({
      kind: "app" as const,
      serviceName: "crea-jarvis",
      serviceNamespace: "apps",
      tracer: {
        startActiveSpan: vi.fn(
          async (
            _name: string,
            fn: (span: {
              setAttribute: () => void;
              setStatus: () => void;
              recordException: () => void;
              end: () => void;
              spanContext: () => {
                traceId: string;
                spanId: string;
                traceFlags: number;
              };
            }) => Promise<unknown>,
          ) =>
            fn({
              setAttribute() {},
              setStatus() {},
              recordException() {},
              end() {},
              spanContext: () => ({
                traceId: "t",
                spanId: "s",
                traceFlags: 1,
              }),
            }),
        ),
      },
      meter: {
        createCounter: vi.fn((name: string) => {
          if (name === "voice_sessions_total") return sessionsTotal;
          if (name === "voice_errors_total") return errorsTotal;
          return { add: vi.fn() };
        }),
        createHistogram: vi.fn(() => sessionDuration),
      },
      logger: { emit: vi.fn() },
      shutdown: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

vi.mock("@crearec/otel", () => ({
  initTelemetry: otel.initTelemetry,
}));

vi.mock("../agent/turn.js", () => ({
  runAgentTurn: vi.fn(async () => ({
    text: "ответ",
    iterations: 1,
    toolResults: [],
  })),
}));

vi.mock("../openai/transcribe.js", () => ({
  transcribeAudio: vi.fn(async () => "голос текст"),
}));

vi.mock("../openai/speech.js", () => ({
  synthesizeSpeech: vi.fn(async () => Buffer.from("OggSxxxx")),
}));

import { ToolGateway } from "../tools/gateway.js";
import { startTelemetry, shutdownTelemetry } from "../telemetry.js";
import type { TelegramSettingsStoreApi } from "./settings-store.js";
import { ChatHandlers } from "./chat-handlers.js";

describe("ChatHandlers", () => {
  beforeAll(async () => {
    await shutdownTelemetry();
    startTelemetry();
  });

  beforeEach(() => {
    otel.sessionsTotal.add.mockClear();
    otel.sessionDuration.record.mockClear();
    otel.errorsTotal.add.mockClear();
  });

  function makeHandlers(mode: "text" | "voice" = "text") {
    const settings: TelegramSettingsStoreApi = {
      isAllowed: vi.fn(async () => true),
      getReplyMode: vi.fn(async () => mode),
      setReplyMode: vi.fn(async (_id, m) => m),
    };
    const tools = new ToolGateway();
    const handlers = new ChatHandlers({
      telegram: {
        enabled: true,
        botToken: "t",
        chatModel: "gpt-4o",
        ttsVoice: "marin",
        ttsModel: "gpt-4o-mini-tts",
        sttModel: "whisper-1",
        maxVoiceBytes: 1_000_000,
        maxVoiceDurationSec: 120,
      },
      openaiApiKey: "sk",
      tools,
      settings,
      getInstructions: async () => "sys",
    });
    return { handlers, settings };
  }

  function makeCtx(overrides: Record<string, unknown> = {}) {
    return {
      reply: vi.fn(async (text: string) => ({ message_id: 1, text })),
      replyWithChatAction: vi.fn(async () => true),
      replyWithVoice: vi.fn(async () => ({ message_id: 2 })),
      telegram: {
        getFileLink: vi.fn(async () => ({ href: "https://example/file.ogg" })),
      },
      message: {},
      ...overrides,
    };
  }

  it("replies with text in text mode", async () => {
    const { handlers } = makeHandlers("text");
    const ctx = makeCtx();
    await handlers.handleText(ctx as never, 1, "привет");
    expect(ctx.reply).toHaveBeenCalledWith("ответ");
    expect(otel.sessionsTotal.add).toHaveBeenCalledWith(1, {
      result: "success",
    });
    expect(otel.sessionDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      { result: "success", handler: "telegram" },
    );
  });

  it("sends voice in voice mode", async () => {
    const { handlers } = makeHandlers("voice");
    const ctx = makeCtx();
    await handlers.handleText(ctx as never, 1, "привет");
    expect(ctx.replyWithVoice).toHaveBeenCalled();
  });

  it("transcribes voice then turns", async () => {
    const tools = new ToolGateway();
    const settings: TelegramSettingsStoreApi = {
      isAllowed: vi.fn(async () => true),
      getReplyMode: vi.fn(async () => "text" as const),
      setReplyMode: vi.fn(async (_id, m) => m),
    };
    const fetchImpl = vi.fn(async () => new Response(Buffer.from("ogg")));
    const h = new ChatHandlers({
      telegram: {
        enabled: true,
        botToken: "t",
        chatModel: "gpt-4o",
        ttsVoice: "marin",
        ttsModel: "gpt-4o-mini-tts",
        sttModel: "whisper-1",
        maxVoiceBytes: 1_000_000,
        maxVoiceDurationSec: 120,
      },
      openaiApiKey: "sk",
      tools,
      settings,
      getInstructions: async () => "sys",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const ctx = makeCtx({
      message: {
        voice: { file_id: "f1", duration: 3, file_size: 100 },
      },
    });
    await h.handleVoice(ctx as never, 1);
    expect(ctx.telegram.getFileLink).toHaveBeenCalledWith("f1");
    expect(ctx.reply).toHaveBeenCalledWith("ответ");
  });

  it("rejects oversized voice", async () => {
    const { handlers } = makeHandlers("text");
    const ctx = makeCtx({
      message: {
        voice: { file_id: "f1", duration: 3, file_size: 9_000_000 },
      },
    });
    await handlers.handleVoice(ctx as never, 1);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringMatching(/слишком большое/i),
    );
  });
});
