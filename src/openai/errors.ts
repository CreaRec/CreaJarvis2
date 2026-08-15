export function openaiErrorMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "unknown error";
  const err = (body as { error?: { message?: unknown } }).error;
  if (err && typeof err.message === "string" && err.message.trim()) {
    return err.message.trim();
  }
  return "unknown error";
}
