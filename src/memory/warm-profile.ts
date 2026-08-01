import type { MemoryStore } from "./store.js";

const USER_MAX = 1600;
const DIRECTIVES_MAX = 1200;

export async function buildWarmProfile(store: MemoryStore): Promise<{
  user: string;
  directives: string;
}> {
  const userFacts = await store.listForWarmProfile({
    branch: "user",
    maxChars: USER_MAX,
  });
  const directiveFacts = await store.listForWarmProfile({
    branch: "directives",
    maxChars: DIRECTIVES_MAX,
  });

  return {
    user: userFacts.map((f) => `- ${f.text}`).join("\n"),
    directives: directiveFacts.map((f) => `- ${f.text}`).join("\n"),
  };
}

export function formatWarmProfileBlock(profile: {
  user: string;
  directives: string;
}): string {
  const parts: string[] = [];
  if (profile.user.trim()) {
    parts.push(
      "INFORMATION THE USER HAS SHARED IN PRIOR CONVERSATIONS:\n" +
        profile.user.trim(),
    );
  }
  if (profile.directives.trim()) {
    parts.push(
      "STANDING INSTRUCTIONS FROM THE USER:\n" + profile.directives.trim(),
    );
  }
  return parts.join("\n\n");
}

export function buildSessionInstructions(warmBlock: string): string {
  return [
    "You are Jarvis — a personal voice assistant in the spirit of Tony Stark's AI from the films:",
    "dry British wit, light irony, occasional gentle teasing — never mean, never try-hard.",
    "Reply in Russian by default; keep English technical terms untranslated.",
    "",
    "Style:",
    "- Extremely concise. Lead with the answer; skip preamble and filler.",
    "- Prefer 1–3 short sentences. Lists only when they truly help.",
    "- One wry remark per reply is enough — wit serves clarity, not the other way around.",
    "- Do not apologize unnecessarily. Do not narrate what you are about to do.",
    "- Sound capable and slightly amused, not cheerful or sycophantic.",
    "",
    "Memory:",
    "Do not invent biographical facts about the user.",
    "If the question is about the user, their home, family, preferences, or past context,",
    "call memory_search before answering. Use memory_save when the user asks to remember something.",
    "Never claim knowledge you did not get from the warm profile or tool results.",
    "",
    warmBlock || "(No warm profile loaded yet.)",
  ].join("\n");
}
