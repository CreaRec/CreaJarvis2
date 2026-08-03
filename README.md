# CreaJarvis2

Personal Jarvis MVP: OpenAI Realtime voice, Prisma + Postgres/pgvector memory, Docker-first.

## Architecture

- **Docker Compose:** `postgres` (pgvector) + `core` (Realtime, tools, memory, reminders, Voice Gateway)
- **Mac / Pi / Linux host:** `clients/desktop` — Python PySide6 native voice client (wake → ack → listen); see [clients/desktop/README.md](clients/desktop/README.md)
- **Multi-device LAN:** one Core, many desktops — household `JARVIS_GATEWAY_TOKEN`, device `hello`, exclusive voice ownership ([ADR-005](docs/ADR-005-multi-device-gateway.md))
- **Memory:** warm profile in session instructions; cold facts in Postgres; search via pgvector (`MemoryRetriever` ready for future Qdrant)
- **Reminders:** Postgres `reminders` + poller; delivery as toast in the desktop client (`reminder.fired`); Debug · Reminders via `GET /debug/reminders` (see [ADR-002](docs/ADR-002-reminders.md))
- **Day plans:** Postgres `day_plans` / `plan_items`; timed items link to reminders; Connect toast `plan.today_digest`; Debug · Plans via `GET /debug/plans` (see [ADR-003](docs/ADR-003-day-plans.md))
- **Themes:** ideas / projects / trips / lists notebooks (`themes` / `theme_entries`); Debug · Themes via `GET /debug/themes` (see [ADR-004](docs/ADR-004-themes.md))

## Quick start

```bash
cp .env.example .env
# set OPENAI_API_KEY, BRAVE_API_KEY, and JARVIS_GATEWAY_TOKEN in .env

docker compose up --build -d
docker compose ps

# import ChatGPT memory export (path on host)
docker compose run --rm \
  -v "$HOME/Downloads/full_chatgpt_memory_export_2026-07-30.md:/import/export.md:ro" \
  core npm run memory:import -- /import/export.md

# text smoke against Voice Gateway (from host, with deps installed)
npm install
npm run smoke:text -- "Как меня зовут?"

# desktop voice client (host mic — not inside Docker)
./clients/desktop/run.sh
# native Qt window → Connect (or autoconnect) → Wake (Space) → speak
```

Audio stays on the host. Core stays in Docker. Details: [clients/desktop/README.md](clients/desktop/README.md).

## Useful commands

| Command | Where | Purpose |
|---------|--------|---------|
| `docker compose up --build` | host | start Core + Postgres |
| `docker compose run --rm core npx prisma migrate deploy` | host | apply migrations |
| `npm run memory:import -- /path/export.md` | compose run / host | ingest markdown facts |
| `./clients/desktop/run.sh` | host | desktop voice client |
| `npm run smoke:text` | host | text turn without mic |

## Health

`GET http://127.0.0.1:8787/health`
