# Docker + GHCR deployment

Production runs as a Docker Compose stack: Postgres (pgvector), Redis (Telegram agent rolling context), Core, Telegram bot, and the ESP syslog LAN bridge. Images come from GitHub Container Registry (GHCR). Releases happen only through GitHub Actions when changes land on `main`. There is no local deploy script.

| Image | Service |
|-------|---------|
| `ghcr.io/crearec/crea-jarvis2` | `core` |
| `ghcr.io/crearec/crea-jarvis2-esp-syslog` | `esp-syslog-bridge` |

Deploy directory: `/home/crearec/crea-jarvis2`

The desktop client is **not** built or deployed. CI runs its pytest suite only. Run the client on Mac/host machines against Core over WebSocket.

## How a release works

1. Merge or push to `main`.
2. Actions runs Core tests, bridge tests, desktop tests, ESP host tests, and builds changed images.
3. **Path filters** decide what publishes:
   - Core paths → push `crea-jarvis2` (`main` + `sha-<short>`)
   - `services/esp-syslog-bridge/**` → push `crea-jarvis2-esp-syslog`
   - `docker-compose.yml` alone → redeploy without rebuilding images
4. Actions copies `docker-compose.yml` to the server, exports **only** the image tags published in that run (`IMAGE_TAG` / `BRIDGE_IMAGE_TAG`), then `docker compose pull && docker compose up -d`.
5. After a successful image publish, `ghcr_cleanup` keeps the **10** newest `sha-*` tags per package, always preserves `:main`, and deletes untagged/orphaned manifests (buildx attestations left behind when tags move).

App secrets stay on the server in `.env`. Postgres data stays in `./data/postgres`; Redis AOF in `./data/redis`. CI never mutates `.env` and never touches Postgres/Redis volumes.

On container start Core runs `prisma migrate deploy`, then `node dist/src/server/index.js`. The bridge listens UDP `:1514` and forwards ESPHome syslog to Alloy as OTLP logs (`service.name=crea-jarvis-client`).

Local development keeps using [`docker-compose.override.yml`](../docker-compose.override.yml) (dev target + bind mounts). That file must **not** be present on the server; CI copies only `docker-compose.yml`.

## One-time server bootstrap

Use the same Linux user that already runs Docker/Portainer (`crearec`).

### 1. GitHub / GHCR

After the first successful publish jobs:

1. Open the `crea-jarvis2` and `crea-jarvis2-esp-syslog` packages under your GitHub user/org.
2. Link them to the `CreaJarvis2` repository if needed.
3. Keep packages **Private**.
4. Under each package **Package settings → Manage Actions access**, grant the `CreaJarvis2` repository **Admin** (required for `ghcr_cleanup` to delete old versions with `GITHUB_TOKEN`).
5. Ensure the server can pull private GHCR images (same `docker login ghcr.io` used for other bots is fine).

### 2. Deploy directory

```sh
mkdir -p /home/crearec/crea-jarvis2/data/postgres /home/crearec/crea-jarvis2/data/redis
cd /home/crearec/crea-jarvis2
```

Create `.env` (never commit it). Minimum:

```sh
IMAGE=ghcr.io/crearec/crea-jarvis2
IMAGE_TAG=main
BRIDGE_IMAGE=ghcr.io/crearec/crea-jarvis2-esp-syslog
BRIDGE_IMAGE_TAG=main

OPENAI_API_KEY=...
JARVIS_GATEWAY_TOKEN=<min-8-chars>
BRAVE_API_KEY=...
GOOGLE_PLACES_API_KEY=...

POSTGRES_USER=jarvis
POSTGRES_PASSWORD=<strong>
POSTGRES_DB=jarvis
# Host port for Mac DB tools (default 5433; container listens on 5432)
POSTGRES_PORT=5433
DATABASE_URL=postgres://jarvis:<strong>@postgres:5432/jarvis
REDIS_URL=redis://redis:6379

USER_TIMEZONE=America/Chicago
# optional: ICLOUD_CALDAV_*, JARVIS_WEATHER_*, REMINDER_*, AGENT_SESSION_*

OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4318
OTEL_SERVICE_NAMESPACE=apps
DEPLOY_ENV=production
# SYSLOG_UDP_PORT=1514
```

`PORT`, `MEMORY_RETRIEVER`, and `VOICE_GATEWAY_URL` have defaults and are not required on the server. Desktop clients set `VOICE_GATEWAY_URL` / `JARVIS_GATEWAY_TOKEN` on the host (or in Settings).

Compose overrides `DATABASE_URL` / `REDIS_URL` for the `core` service to reach the `postgres` / `redis` hostnames.

### 3. First start

Either merge to `main` and let Actions deploy, or:

```sh
cd /home/crearec/crea-jarvis2
docker compose pull
docker compose up -d
```

Then:

```sh
docker compose ps
docker compose logs -f core
docker compose logs -f esp-syslog-bridge
curl -sS http://127.0.0.1:8787/health
```

**Do not** place `docker-compose.override.yml` in the deploy directory. **Do not** run `docker compose down -v` (wipes Postgres).

### 4. Desktop against production Core

On the Mac/host (not on the server):

```sh
export VOICE_GATEWAY_URL=ws://<DEPLOY_HOST-or-LAN-IP>:8787/voice
export JARVIS_GATEWAY_TOKEN=<same as server .env>
./clients/desktop/run.sh
```

### 5. Voice PE syslog

On the PE, set `syslog_host` in `secrets.yaml` to the Core **LAN** IP (same host as `jarvis_gateway_url`, e.g. `192.168.1.135`). Flash firmware so ESPHome syslog hits UDP `1514`.

Loki / Grafana Explore:

```logql
{service_name="crea-jarvis-client"}
```

```logql
{service_name="crea-jarvis-client"} | severity_text=~"(?i)error|warn"
```

Attrs include `component`, `host_name`, `esp_tag` (ESPHome logger tag).

## Day-to-day operations

Deploy: merge to `main` (only changed images republish).

On the server (or via Portainer):

```sh
cd /home/crearec/crea-jarvis2
docker compose ps
docker compose logs -f core
docker compose logs -f esp-syslog-bridge
docker compose restart core
docker compose restart esp-syslog-bridge
```

## GitHub Actions secrets

| Secret | Purpose |
|--------|---------|
| `DEPLOY_SSH_KEY` | Private key for SSH deploy |
| `DEPLOY_HOST` | Tailscale IP or MagicDNS hostname of the server |
| `DEPLOY_USER` | SSH user |
| `TS_OAUTH_CLIENT_ID` | Tailscale OAuth client ID (Trust credentials) for ephemeral CI nodes |
| `TS_OAUTH_SECRET` | Tailscale OAuth client secret (Trust credentials) |

Deploy joins the tailnet with `tag:ci` via [`tailscale/github-action`](https://github.com/tailscale/github-action), then SSHs to `DEPLOY_HOST`. Create the OAuth client under Tailscale **Settings → Trust credentials** (not legacy OAuth clients).

GHCR push and cleanup use the workflow `GITHUB_TOKEN` (`packages: write`). No extra registry secret is required for publish or for pruning old `sha-*` versions.

The deploy user needs Docker Compose without sudo.
