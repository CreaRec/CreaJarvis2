import WebSocket from "ws";
import { loadConfig } from "../src/config.js";
import { randomUUID } from "node:crypto";

async function main(): Promise<void> {
  const config = loadConfig();
  const text = process.argv.slice(2).join(" ") || "Как меня зовут?";
  const url = config.VOICE_GATEWAY_URL;

  console.log(`[smoke] connecting to ${url}`);
  const ws = new WebSocket(url);

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });

  ws.send(
    JSON.stringify({
      type: "hello",
      token: config.JARVIS_GATEWAY_TOKEN,
      deviceId: `smoke-${randomUUID()}`,
      displayName: "smoke-text",
      caps: { voice: true, notify: true },
    }),
  );

  let helloOk = false;
  let gotAssistant = false;
  let gotDone = false;
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString()) as {
      type: string;
      role?: string;
      text?: string;
      message?: string;
    };
    if (msg.type === "hello.ok") {
      helloOk = true;
      console.log("[smoke] hello.ok, session.start");
      ws.send(JSON.stringify({ type: "session.start" }));
    } else if (msg.type === "ready") {
      console.log("[smoke] session ready, sending text:", text);
      ws.send(JSON.stringify({ type: "text", text }));
    } else if (msg.type === "transcript") {
      console.log(`[smoke] ${msg.role}: ${msg.text}`);
      if (msg.role === "assistant") gotAssistant = true;
    } else if (msg.type === "response.done") {
      gotDone = true;
    } else if (msg.type === "error") {
      console.error("[smoke] error:", msg.message);
    } else if (msg.type === "session.busy") {
      console.error("[smoke] session busy");
    }
  });

  // Wait until a full response cycle finishes (tools may run after a preamble).
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && !(helloOk && gotAssistant && gotDone)) {
    await new Promise((r) => setTimeout(r, 200));
  }

  ws.send(JSON.stringify({ type: "session.end" }));
  ws.close();
  if (!helloOk || !gotAssistant || !gotDone) {
    console.error(
      `[smoke] timed out (hello=${helloOk}, assistant=${gotAssistant}, done=${gotDone})`,
    );
    process.exit(1);
  }
  console.log("[smoke] ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
