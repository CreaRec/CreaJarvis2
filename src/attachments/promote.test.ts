import { describe, expect, it, vi } from "vitest";
import { describeAttachment } from "./promote.js";

describe("describeAttachment", () => {
  it("uses high-detail vision and requests exhaustive searchable facts", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/files") && init?.method === "POST") {
        const form = init.body as FormData;
        expect(form.get("purpose")).toBe("vision");
        return Response.json({ id: "file_image" });
      }
      if (url.endsWith("/v1/responses")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          instructions: string;
          input: Array<{ content: unknown[] }>;
        };
        expect(body.instructions).toContain(
          "transcribe all relevant visible facts exactly",
        );
        expect(body.instructions).toContain("booking/confirmation codes");
        expect(body.input[0]?.content).toContainEqual({
          type: "input_image",
          file_id: "file_image",
          detail: "high",
        });
        return Response.json({
          id: "resp_description",
          output_text: "AA406, confirmation WCKATW",
          output: [],
        });
      }
      if (url.endsWith("/v1/files/file_image") && init?.method === "DELETE") {
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const result = await describeAttachment({
      apiKey: "sk",
      model: "gpt-4o",
      filename: "booking.jpg",
      mimeType: "image/jpeg",
      bytes: Buffer.from("image"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.description).toBe("AA406, confirmation WCKATW");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
