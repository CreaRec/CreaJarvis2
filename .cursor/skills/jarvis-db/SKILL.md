---
name: jarvis-db
description: >-
  Read-only queries against production CreaJarvis2 Postgres (reminders,
  calendar links, facts, plans, devices). Use when inspecting prod DB rows,
  fireAt/calendarEndAt times, reminder text, or debugging calendar/reminder
  issues / jarvis-db.
---

# Jarvis DB (read-only)

Production Postgres for this repo only. Prefer the helper script over ad-hoc
clients. **Never** run writes (INSERT/UPDATE/DELETE/DDL).

## Auth (never store the password in the skill or chat)

No connection defaults. Credentials must come from env or config:

1. Env: `JARVIS_DB_URL` **or** all of `JARVIS_DB_HOST` / `JARVIS_DB_PORT` / `JARVIS_DB_NAME` / `JARVIS_DB_USER` / `JARVIS_DB_PASSWORD`
2. Config file: `~/.config/jarvis-db/config.env`

```bash
# ~/.config/jarvis-db/config.env
# chmod 600 ~/.config/jarvis-db/config.env

JARVIS_DB_HOST=...
JARVIS_DB_PORT=...
JARVIS_DB_NAME=...
JARVIS_DB_USER=...
JARVIS_DB_PASSWORD=...

# optional instead of discrete fields:
# JARVIS_DB_URL=postgresql://USER:PASSWORD@HOST:PORT/DB
```

Template: `~/.config/jarvis-db/config.env.example`. Do **not** put the password
in the repo `.env` (that file is for local Docker / different `DATABASE_URL`).

If config is missing, stop and tell the user to create
`~/.config/jarvis-db/config.env` (mode `600`). Do not ask them to paste secrets into chat.

## Workflow

From repo root (script re-execs into `~/.cache/cursor-skills/jarvis-db/.venv` when needed):

```bash
python3 .cursor/skills/jarvis-db/scripts/query_db.py health
python3 .cursor/skills/jarvis-db/scripts/query_db.py tables
python3 .cursor/skills/jarvis-db/scripts/query_db.py describe reminders
python3 .cursor/skills/jarvis-db/scripts/query_db.py query \
  --sql 'SELECT id, text, "fireAt", "calendarEndAt", "locationName", "createdAt" FROM reminders ORDER BY "createdAt" DESC LIMIT 20'
```

## Script reference

| Command | Purpose |
|---------|---------|
| `health` | Ping DB |
| `tables` | List `public` tables |
| `describe <table>` | Columns for one table |
| `query --sql '…'` | Single read-only statement |

Flags for `query`:

- `--sql` / `-q` — required
- `--limit` — max printed rows (default `100`)

Prisma maps camelCase columns — **quote them** in SQL: `"fireAt"`, `"calendarEndAt"`, `"createdAt"`, `"rawUtterance"`, `"locationName"`, etc.

## Schema cheat sheet

| Table | Use |
|-------|-----|
| `reminders` | Timed reminders + Apple Calendar link (`calendarUid`, `calendarHref`, `calendarEndAt`) |
| `facts` / `meta` | Long-term memory |
| `day_plans` / `plan_items` | Day agenda |
| `themes` / `theme_entries` | Themed memory |
| `devices` | Voice devices |

## Safety

- Script forces `default_transaction_read_only=on` and rejects non-SELECT-like SQL.
- Do not use local Docker Postgres for prod investigations — that DB is empty/dev.
- Allow network for the query (private/Tailscale host from config).
- Never print the password or full DSN with credentials.

## Output style

- Lead with the rows that answer the question (times in UTC as stored; convert to `America/Chicago` when explaining to the user).
- Quote `id`, `text`, `"fireAt"`, `"calendarEndAt"` when debugging calendar duration bugs.
- If empty: say so, then widen the time window or relax the filter.
