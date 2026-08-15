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

describe("compose redis", () => {
  it("defines redis with healthcheck and core depends on it", () => {
    const yml = readFileSync(resolve(root, "docker-compose.yml"), "utf8");
    const redis = serviceBlock(yml, "redis");
    expect(redis).toMatch(/image:\s*redis:7-alpine/);
    expect(redis).toMatch(/redis-cli.*ping|CMD.*redis-cli/);
    expect(redis).toMatch(/\.\/data\/redis:\/data/);

    const core = serviceBlock(yml, "core");
    expect(core).toMatch(/redis:\s*\n\s*condition:\s*service_healthy/);
    expect(core).toMatch(/REDIS_URL:.*redis:\/\/redis:6379/);
  });
});
