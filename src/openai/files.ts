import { openaiErrorMessage } from "./errors.js";

export type ChatFetch = typeof fetch;

export function openAiFilePurposeForMime(mimeType: string): "vision" | "user_data" {
  return mimeType.toLowerCase().startsWith("image/") ? "vision" : "user_data";
}

export async function uploadOpenAiFile(input: {
  apiKey: string;
  bytes: Buffer;
  filename: string;
  mimeType?: string;
  /** Files API purpose; user_data works with Responses file inputs. */
  purpose?: string;
  fetchImpl?: ChatFetch;
}): Promise<{ id: string }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const form = new FormData();
  const blob = new Blob([new Uint8Array(input.bytes)], {
    type: input.mimeType?.trim() || "application/octet-stream",
  });
  form.append("file", blob, input.filename);
  form.append("purpose", input.purpose ?? "user_data");

  const response = await fetchImpl("https://api.openai.com/v1/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: form,
  });
  const json = (await response.json()) as { id?: string };
  if (!response.ok || typeof json.id !== "string") {
    throw new Error(
      `OpenAI file upload failed (${response.status}): ${openaiErrorMessage(json)}`,
    );
  }
  return { id: json.id };
}

export async function deleteOpenAiFile(input: {
  apiKey: string;
  fileId: string;
  fetchImpl?: ChatFetch;
}): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `https://api.openai.com/v1/files/${encodeURIComponent(input.fileId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
      },
    },
  );
  if (!response.ok && response.status !== 404) {
    const json = (await response.json().catch(() => ({}))) as unknown;
    throw new Error(
      `OpenAI file delete failed (${response.status}): ${openaiErrorMessage(json)}`,
    );
  }
}
