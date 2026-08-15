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
