# ADR-001: Realtime voice, Prisma memory, Docker layout

- **Status:** Accepted
- **Date:** 2026-07-31

## Context

Build a personal Jarvis from scratch (no upstream fork). First slice: talk via OpenAI Realtime with long-term memory, runnable Docker-first on a Mac without putting the microphone inside a container.

## Decision

### 1. Docker-first core

- `postgres` (pgvector/pg16) and `core` run under Docker Compose.
- `core` owns OpenAI API key, Realtime WebSocket, Tool Gateway, Prisma/memory.
- Host runs a thin audio client (`clients/web-ptt` temporarily; later desktop/room). Docker Desktop on Mac cannot reliably pass through audio devices.

### 2. Voice Gateway protocol

PTT client ↔ `ws://localhost:8787/voice`:

- inbound: `session.start` | `audio.append` | `audio.commit` | `session.end` | `text`
- outbound: `ready` | `audio.delta` | `transcript` | `tool.status` | `error` | `reminder.fired` | `reminder.missed_digest` (reminders: ADR-002) | `plan.today_digest` (day plans: ADR-003)

Realtime session uses manual turn detection (`turn_detection: null`) so commit happens on button release / toggle.

### 3. Prisma + pgvector as cold store

- Schema and migrations live in `prisma/`.
- `Fact.embedding` is `Unsupported("vector(1536)")`; writes/searches use `$executeRaw` / `$queryRaw`.
- `core` entrypoint runs `prisma migrate deploy` before listen.
- Warm profile (user + directives, non-private) is injected into Realtime instructions; full export is never dumped into the session.

### 4. Store vs Retriever (Qdrant-ready)

```text
MemoryStore  → Prisma CRUD (source of truth)
MemoryRetriever → ranking by id (PgVectorRetriever today)
```

Future `QdrantRetriever` returns ids only; facts still hydrate from Postgres. Switch via `MEMORY_RETRIEVER=qdrant` and a new Compose service — tools stay unchanged.

### 5. Tools

Typed tools only: `memory_search`, `memory_timeline`, `memory_save`, `get_current_time`, search tools, reminder tools (ADR-002), day-plan tools (ADR-003), and theme tools (ADR-004). Executed on Core; results returned as Realtime `function_call_output`. No open shell tool.

- `memory_search` — semantic / relevance ranking for «what do you know about X».
- `memory_timeline` — keyword match, chronological `createdAt` order for «what did I say about X over time».

## Consequences

- Local Node+Postgres without Docker is not the supported dev path.
- PTT requires `sox` (`rec`) on the Mac host.
- Vector column is outside Prisma's typed API; raw SQL is intentional for ANN.
- Adding Qdrant later does not require migrating fact text out of Postgres.
