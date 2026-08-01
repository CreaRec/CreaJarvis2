# ADR-004: Themes (ideas, projects, trips)

- **Status:** Accepted
- **Date:** 2026-08-01

## Context

Jarvis needs named, revisitable notebooks for ideas, projects, and trip planning — distinct from biographical memory, timed reminders, and daily agendas.

## Decision

### 1. Theme + ThemeEntry

- `themes`: `kind` (idea|project|trip), `status` (active|on_hold|done|archived), title, summary, JSON `meta`, `lastTouchedAt`, embedding.
- `theme_entries`: note|question|decision|checklist|link with open|done|cancelled.
- No privacy/sensitivity fields in v1.

### 2. Tools

`theme_create`, `theme_list`, `theme_get`, `theme_search`, `theme_add_entry`, `theme_update`, `theme_update_entry`, `theme_promote`, `theme_archive`.

Cross-links to day plans / reminders via instructions only (call `plan_*` / `reminder_*` after `theme_get`).

### 3. Delivery / UI

No Connect toast. Debug: `GET /debug/themes` + **Debug · Themes** in web-ptt.

## Consequences

- Ambiguous name matches return candidates for clarification.
- Trip/project structure lives in `meta` JSON; freeform detail in entries.
- Promote only idea→project in v1.
