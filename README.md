# CreaJarvis2

Personal Jarvis MVP: OpenAI Realtime voice, Prisma + Postgres/pgvector memory, Docker-first.

## Architecture

- **Docker Compose:** `postgres` (pgvector) + `core` (Realtime, tools, memory, reminders, Voice Gateway)
- **Mac host (temp):** `npm run web-ptt` — browser push-to-talk at http://127.0.0.1:5173
- **Memory:** warm profile in session instructions; cold facts in Postgres; search via pgvector (`MemoryRetriever` ready for future Qdrant)
- **Reminders:** Postgres `reminders` + poller; delivery as bottom toast in web-ptt (`reminder.fired`); Debug · Reminders table via `GET /debug/reminders` (see [ADR-002](docs/ADR-002-reminders.md))
- **Day plans:** Postgres `day_plans` / `plan_items`; timed items link to reminders; Connect toast `plan.today_digest`; Debug · Plans via `GET /debug/plans` (see [ADR-003](docs/ADR-003-day-plans.md))
- **Themes:** ideas / projects / trips / lists notebooks (`themes` / `theme_entries`); Debug · Themes via `GET /debug/themes` (see [ADR-004](docs/ADR-004-themes.md))

## Quick start

```bash
cp .env.example .env
# set OPENAI_API_KEY in .env

docker compose up --build -d
docker compose ps

# import ChatGPT memory export (path on host)
docker compose run --rm \
  -v "$HOME/Downloads/full_chatgpt_memory_export_2026-07-30.md:/import/export.md:ro" \
  core npm run memory:import -- /import/export.md

# text smoke against Voice Gateway (from host, with deps installed)
npm install
npm run smoke:text -- "Как меня зовут?"

# temporary browser PTT (isolated from core)
npm run web-ptt
# open http://127.0.0.1:5173 → Connect → hold button to talk
```

Browser client lives only in `clients/web-ptt/` (not in Docker image). Delete that folder when a real desktop client replaces it.

## Useful commands

| Command | Where | Purpose |
|---------|--------|---------|
| `docker compose up --build` | host | start Core + Postgres |
| `docker compose run --rm core npx prisma migrate deploy` | host | apply migrations |
| `npm run memory:import -- /path/export.md` | compose run / host | ingest markdown facts |
| `npm run web-ptt` | host | temp browser PTT (http://127.0.0.1:5173) |
| `npm run smoke:text` | host | text turn without mic |

## Health

`GET http://127.0.0.1:8787/health`
