import { openaiErrorMessage } from "./errors.js";

export type SpeechFetch = typeof fetch;

export async function synthesizeSpeech(input: {
  apiKey: string;
  text: string;
  voice: string;
  model?: string;
  /** OpenAI TTS format; opus is suitable for Telegram voice after packaging. */
  responseFormat?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
  fetchImpl?: SpeechFetch;
}): Promise<Buffer> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model ?? "gpt-4o-mini-tts",
      voice: input.voice,
      input: input.text,
      response_format: input.responseFormat ?? "opus",
    }),
  });

  if (!response.ok) {
    let message = `status ${response.status}`;
    try {
      const json = (await response.json()) as unknown;
      message = openaiErrorMessage(json);
    } catch {
      // ignore body parse errors
    }
    throw new Error(`OpenAI speech failed (${response.status}): ${message}`);
  }

  const ab = await response.arrayBuffer();
  return Buffer.from(ab);
}
