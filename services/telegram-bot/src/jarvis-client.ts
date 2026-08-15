export async function jarvisAgentTurn(input: {
  baseUrl: string;
  token: string;
  text: string;
  userId: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = `${input.baseUrl.replace(/\/$/, "")}/internal/agent/turn`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: input.text, userId: input.userId }),
  });
  const json = (await response.json()) as {
    ok?: boolean;
    text?: string;
    error?: string;
  };
  if (!response.ok || !json.ok || typeof json.text !== "string") {
    throw new Error(
      json.error?.trim() ||
        `Jarvis agent turn failed (${response.status})`,
    );
  }
  return json.text;
}

export async function jarvisClearSession(input: {
  baseUrl: string;
  token: string;
  userId: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = `${input.baseUrl.replace(/\/$/, "")}/internal/agent/session/clear`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ userId: input.userId }),
  });
  const json = (await response.json()) as {
    ok?: boolean;
    error?: string;
  };
  if (!response.ok || !json.ok) {
    throw new Error(
      json.error?.trim() ||
        `Jarvis session clear failed (${response.status})`,
    );
  }
}

export async function jarvisInboxAdd(input: {
  baseUrl: string;
  token: string;
  userId: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  fetchImpl?: typeof fetch;
}): Promise<{ count: number; totalBytes: number }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = `${input.baseUrl.replace(/\/$/, "")}/internal/inbox/add`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "X-Jarvis-User-Id": input.userId,
      "X-Jarvis-Filename": input.filename,
      "X-Jarvis-Mime-Type": input.mimeType,
      "Content-Type": input.mimeType,
    },
    body: new Uint8Array(input.bytes),
  });
  const json = (await response.json()) as {
    ok?: boolean;
    count?: number;
    totalBytes?: number;
    error?: string;
  };
  if (
    !response.ok ||
    !json.ok ||
    typeof json.count !== "number" ||
    typeof json.totalBytes !== "number"
  ) {
    throw new Error(
      json.error?.trim() || `Jarvis inbox add failed (${response.status})`,
    );
  }
  return { count: json.count, totalBytes: json.totalBytes };
}
