import type { AppConfig } from "../config.js";

export class Embedder {
  constructor(private readonly config: AppConfig) {}

  async embed(text: string): Promise<number[]> {
    const vectors = await this.embedMany([text]);
    return vectors[0]!;
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.EMBEDDING_MODEL,
        input: texts,
        dimensions: this.config.EMBEDDING_DIMENSIONS,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Embeddings failed (${response.status}): ${body}`);
    }

    const json = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };
    return json.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}
