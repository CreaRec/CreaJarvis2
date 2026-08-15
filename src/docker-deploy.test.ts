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

  it("docker-compose includes telegram-bot sidecar image", async () => {
    const compose = await readFile(path.join(repoRoot, "docker-compose.yml"), "utf8");
    expect(compose).toMatch(/telegram-bot:/);
    expect(compose).toMatch(/ghcr\.io\/crearec\/crea-jarvis2-telegram/);
    expect(compose).toMatch(/data\/telegram-bot\/users\.json/);
    expect(compose).toMatch(/JARVIS_BASE_URL: http:\/\/core:8787/);
  });

  it("Dockerfile uses GitHub Packages auth for npm install", async () => {
    const dockerfile = await readFile(path.join(repoRoot, "Dockerfile"), "utf8");

    expect(dockerfile).toMatch(/NODE_AUTH_TOKEN/);
    expect(dockerfile).toMatch(/COPY \.npmrc package\.json package-lock\.json/);
    expect(dockerfile).toMatch(/--mount=type=secret,id=NODE_AUTH_TOKEN/);
  });

  it("telegram-bot Dockerfile installs ffmpeg", async () => {
    const dockerfile = await readFile(
      path.join(repoRoot, "services/telegram-bot/Dockerfile"),
      "utf8",
    );
    expect(dockerfile).toMatch(/ffmpeg/);
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

  it("CI path filters gate core, telegram service, and bridge publishes", async () => {
    const workflow = await readFile(
      path.join(repoRoot, ".github/workflows/ci-cd.yml"),
      "utf8",
    );

    expect(workflow).toMatch(/telegram:\s*\n\s+- 'services\/telegram-bot\/\*\*'/);
    expect(workflow).toMatch(/publish_telegram:/);
    expect(workflow).toMatch(/TELEGRAM_IMAGE/);
    expect(workflow).toMatch(/crea-jarvis2-telegram/);
  });

  it("CI prunes GHCR to keep 10 sha-* tags and preserve main", async () => {
    const workflow = await readFile(
      path.join(repoRoot, ".github/workflows/ci-cd.yml"),
      "utf8",
    );

    expect(workflow).toMatch(/ghcr_cleanup:/);
    expect(workflow).toMatch(/dataaxiom\/ghcr-cleanup-action@v1/);
    expect(workflow).toMatch(/packages:\s*crea-jarvis2\b/);
    expect(workflow).toMatch(/packages:\s*crea-jarvis2-telegram\b/);
    expect(workflow).toMatch(/packages:\s*crea-jarvis2-esp-syslog\b/);
    expect(workflow).toMatch(/delete-tags:\s*sha-\*/);
    expect(workflow).toMatch(/keep-n-tagged:\s*"10"/);
    expect(workflow).toMatch(/exclude-tags:\s*main/);
    expect(workflow).toMatch(/delete-untagged:\s*true/);
    expect(workflow).toMatch(/delete-orphaned-images:\s*true/);
  });
});
