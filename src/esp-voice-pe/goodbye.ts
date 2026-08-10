/**
 * Goodbye detection mirrored from clients/esp-voice-pe (and desktop goodbye.py).
 * Keeps Core CI covering ESP client phrase logic without an ESP toolchain.
 */
export function normalizeUtterance(text: string): string {
  let t = (text || "").normalize("NFKC").toLowerCase().trim().replace(/ё/g, "е");
  t = t.replace(/[^\p{L}\p{N}\s]+/gu, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

const GOODBYE_EXACT = new Set([
  "пока",
  "все",
  "до свидания",
  "давай до свидания",
  "давай пока",
  "спасибо джарвис",
  "спасибо джарвис спасибо",
  "благодарю джарвис",
  "пока джарвис",
  "до свидания джарвис",
  "все джарвис",
  "на этом все джарвис",
  "джарвис спасибо",
  "джарвис пока",
  "джарвис все",
  "джарвис до свидания",
  "thank you jarvis",
  "thanks jarvis",
  "bye jarvis",
  "goodbye jarvis",
  "jarvis thanks",
  "jarvis bye",
]);

const GOODBYE_PREFIX = [
  "спасибо джарвис",
  "благодарю джарвис",
  "пока джарвис",
  "до свидания джарвис",
  "все джарвис",
  "на этом все джарвис",
  "давай до свидания",
  "до свидания",
  "thank you jarvis",
  "thanks jarvis",
  "bye jarvis",
  "goodbye jarvis",
];

const FILLERS = new Set(["", "пожалуйста", "все", "ладно", "ок", "окей"]);

function shortNamePlusFarewell(norm: string): boolean {
  const words = norm.split(" ");
  if (words.length === 2 && words[1] === "пока" && words[0].length >= 1 && words[0].length <= 20)
    return true;
  if (
    words.length === 3 &&
    words[1] === "до" &&
    words[2] === "свидания" &&
    words[0].length >= 1 &&
    words[0].length <= 12
  )
    return true;
  return false;
}

export function isGoodbyeUtterance(text: string): boolean {
  const norm = normalizeUtterance(text);
  if (!norm) return false;
  if (GOODBYE_EXACT.has(norm)) return true;
  if (shortNamePlusFarewell(norm)) return true;
  for (const prefix of GOODBYE_PREFIX) {
    if (norm === prefix) return true;
    if (norm.startsWith(prefix + " ")) {
      const rest = norm.slice(prefix.length).trim();
      if (FILLERS.has(rest)) return true;
      if (rest.split(" ").length <= 1 && rest.length <= 12) return true;
    }
  }
  return false;
}

export const ESP_VAD = {
  SILENCE_EOS_MS: 700,
  MIN_UTTERANCE_MS: 250,
  SPEECH_RMS_THRESHOLD: 500,
  IDLE_TIMEOUT_S: 5 * 60,
  TARGET_RATE: 24_000,
} as const;
