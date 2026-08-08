import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

function serviceBlock(yml: string, service: string): string {
  const re = new RegExp(
    `(?:^|\\n)  ${service}:\\n([\\s\\S]*?)(?=\\n  [a-zA-Z]|\\n[a-zA-Z]|\\s*$)`,
  );
  const match = yml.match(re);
  if (!match) {
    throw new Error(`service ${service} not found`);
  }
  return match[1] ?? "";
}

describe("compose postgres networking", () => {
  it("publishes postgres on host 5433 by default (not 5432)", () => {
    const yml = readFileSync(resolve(root, "docker-compose.yml"), "utf8");
    const postgres = serviceBlock(yml, "postgres");
    expect(postgres).toMatch(/POSTGRES_PORT:-5433}:5432/);
    expect(postgres).not.toMatch(/POSTGRES_PORT:-5432}/);
  });
});
