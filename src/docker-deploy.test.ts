import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");

describe("docker deploy contract", () => {
  it("docker-compose.yml wires OTEL to Alloy on external lgtm network", async () => {
    const compose = await readFile(path.join(repoRoot, "docker-compose.yml"), "utf8");

    expect(compose).toMatch(/ghcr\.io\/crearec\/crea-jarvis2/);
    expect(compose).toMatch(/OTEL_EXPORTER_OTLP_ENDPOINT/);
    expect(compose).toMatch(/OTEL_SERVICE_NAME/);
    expect(compose).toMatch(/OTEL_SERVICE_NAMESPACE/);
    expect(compose).toMatch(/DEPLOY_ENV/);
    expect(compose).toMatch(/lgtm:\s*\n\s*external:\s*true/);
    expect(compose).toMatch(/alloy:4318/);
    expect(compose).toMatch(/OTEL_SERVICE_NAME:.*crea-jarvis/);
    expect(compose).toMatch(/OTEL_SERVICE_NAMESPACE:.*apps/);
  });

  it("Dockerfile uses GitHub Packages auth for npm install", async () => {
    const dockerfile = await readFile(path.join(repoRoot, "Dockerfile"), "utf8");

    expect(dockerfile).toMatch(/NODE_AUTH_TOKEN/);
    expect(dockerfile).toMatch(/COPY \.npmrc package\.json package-lock\.json/);
    expect(dockerfile).toMatch(/--mount=type=secret,id=NODE_AUTH_TOKEN/);
  });

  it("CI passes NODE_AUTH_TOKEN for npm ci and image builds", async () => {
    const workflow = await readFile(
      path.join(repoRoot, ".github/workflows/ci-cd.yml"),
      "utf8",
    );

    expect(workflow).toMatch(/NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
    expect(workflow).toMatch(/NODE_AUTH_TOKEN=\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
    expect(workflow).toMatch(/packages:\s*read/);
  });
});
