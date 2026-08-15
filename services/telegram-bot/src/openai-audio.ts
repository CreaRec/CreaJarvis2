export function openaiErrorMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "unknown error";
  const err = (body as { error?: { message?: unknown } }).error;
  if (err && typeof err.message === "string" && err.message.trim()) {
    return err.message.trim();
  }
  return "unknown error";
}

export async function transcribeAudio(input: {
  apiKey: string;
  audio: Buffer;
  filename: string;
  model?: string;
  language?: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const form = new FormData();
  form.append("model", input.model ?? "whisper-1");
  if (input.language) form.append("language", input.language);
  form.append(
    "file",
    new Blob([new Uint8Array(input.audio)], {
      type: "application/octet-stream",
    }),
    input.filename,
  );

  const response = await fetchImpl(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}` },
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

export async function synthesizeSpeech(input: {
  apiKey: string;
  text: string;
  voice: string;
  model?: string;
  responseFormat?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
  fetchImpl?: typeof fetch;
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
      message = openaiErrorMessage((await response.json()) as unknown);
    } catch {
      // ignore
    }
    throw new Error(`OpenAI speech failed (${response.status}): ${message}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
