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
    "You are Jarvis, a personal voice assistant.",
    "Reply in Russian by default; keep English technical terms untranslated.",
    "Be concise, practical, and structured. Avoid filler.",
    "Do not invent biographical facts about the user.",
    "If the question is about the user, their home, family, preferences, or past context,",
    "call memory_search before answering. Use memory_save when the user asks to remember something.",
    "Never claim knowledge you did not get from the warm profile or tool results.",
    "",
    warmBlock || "(No warm profile loaded yet.)",
  ].join("\n");
}
