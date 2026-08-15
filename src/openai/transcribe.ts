import { openaiErrorMessage } from "./errors.js";

export type TranscribeFetch = typeof fetch;

export async function transcribeAudio(input: {
  apiKey: string;
  audio: Buffer;
  filename: string;
  model?: string;
  language?: string;
  fetchImpl?: TranscribeFetch;
}): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const form = new FormData();
  form.append("model", input.model ?? "whisper-1");
  if (input.language) form.append("language", input.language);
  const blob = new Blob([new Uint8Array(input.audio)], {
    type: "application/octet-stream",
  });
  form.append("file", blob, input.filename);

  const response = await fetchImpl(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: form,
    },
  );

  const json = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(
      `OpenAI transcribe failed (${response.status}): ${openaiErrorMessage(json)}`,
    );
  }

  const text =
    json && typeof json === "object" && "text" in json
      ? (json as { text?: unknown }).text
      : undefined;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("OpenAI transcribe response missing text");
  }
  return text.trim();
}
