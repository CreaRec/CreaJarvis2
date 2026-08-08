# Docker + GHCR deployment

Production runs as a Docker Compose stack: Postgres (pgvector) plus the Core image from GitHub Container Registry (GHCR). Releases happen only through GitHub Actions when changes land on `main`. There is no local deploy script.

Image: `ghcr.io/crearec/crea-jarvis2`

Deploy directory: `/home/crearec/crea-jarvis2`

The desktop client is **not** built or deployed. CI runs its pytest suite only. Run the client on Mac/host machines against Core over WebSocket.

## How a release works

1. Merge or push to `main`.
2. Actions runs Core tests (`npm test`), desktop tests (`pytest` in `clients/desktop`), and builds the image.
3. Actions pushes tags `main` and `sha-<short>` to GHCR.
4. Actions copies `docker-compose.yml` to the server, exports `IMAGE_TAG` in the SSH session (overrides `.env` for Compose interpolation), then runs `docker compose pull && docker compose up -d`.

App secrets stay on the server in `.env`. Postgres data stays in `./data/postgres`. CI never mutates `.env` and never touches Postgres volumes.

On container start Core runs `prisma migrate deploy`, then `node dist/src/server/index.js`.

Local development keeps using [`docker-compose.override.yml`](../docker-compose.override.yml) (dev target + bind mounts). That file must **not** be present on the server; CI copies only `docker-compose.yml`.

## One-time server bootstrap

Use the same Linux user that already runs Docker/Portainer (`crearec`).

### 1. GitHub / GHCR

After the first successful `publish` job:

1. Open the `crea-jarvis2` package under your GitHub user/org.
2. Link it to the `CreaJarvis2` repository if needed.
3. Keep the package **Private**.
4. Ensure the server can pull private GHCR images (same `docker login ghcr.io` used for other bots is fine).

### 2. Deploy directory

```sh
mkdir -p /home/crearec/crea-jarvis2/data/postgres
cd /home/crearec/crea-jarvis2
```

Create `.env` (never commit it). Minimum:

```sh
IMAGE=ghcr.io/crearec/crea-jarvis2
IMAGE_TAG=main

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

USER_TIMEZONE=America/Chicago
# optional: ICLOUD_CALDAV_*, JARVIS_WEATHER_*, REMINDER_*
```

`PORT`, `MEMORY_RETRIEVER`, and `VOICE_GATEWAY_URL` have defaults and are not required on the server. Desktop clients set `VOICE_GATEWAY_URL` / `JARVIS_GATEWAY_TOKEN` on the host (or in Settings).

Compose overrides `DATABASE_URL` for the `core` service to reach the `postgres` hostname.

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

## Day-to-day operations

Deploy: merge to `main`.

On the server (or via Portainer):

```sh
cd /home/crearec/crea-jarvis2
docker compose ps
docker compose logs -f core
docker compose restart core
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

GHCR push uses the workflow `GITHUB_TOKEN` (`packages: write`). No extra registry secret is required for publish.

The deploy user needs Docker Compose without sudo.
