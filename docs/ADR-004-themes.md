# ADR-004: Themes (ideas, projects, trips, lists)

- **Status:** Accepted
- **Date:** 2026-08-01
- **Updated:** 2026-08-01 — added `list` kind + bulk entries

## Context

Jarvis needs named, revisitable notebooks for ideas, projects, trip planning, and checklists (shopping / bucket list). Packing for a trip belongs on the trip theme itself — not a separate list entity.

## Decision

### 1. Theme + ThemeEntry

- `themes`: `kind` (idea|project|trip|**list**), `status` (active|on_hold|done|archived), title, summary, JSON `meta`, `lastTouchedAt`, embedding.
- `theme_entries`: note|question|decision|checklist|link with open|done|cancelled.
- **list** = shopping, bucket list, or any named checklist notebook.
- **Packing / сборы** = checklist entries on an existing **trip** theme (no FK, no separate list).
- No privacy/sensitivity fields in v1. Existing trips are not migrated.

### 2. Tools

`theme_create`, `theme_list`, `theme_get`, `theme_search`, `theme_add_entry`, **`theme_add_entries`**, `theme_update`, `theme_update_entry`, `theme_promote`, `theme_archive`.

- `theme_add_entries`: bulk add; default item kind = `checklist` when omitted.
- `theme_add_entry`: single item; default kind remains `note`.
- Cross-links to day plans / reminders via instructions only (`plan_*` / `reminder_*` after `theme_get`).

### 3. Delivery / UI

No Connect toast. Debug: `GET /debug/themes` + **Debug · Themes** in web-ptt.

## Consequences

- Ambiguous name matches return candidates for clarification.
- Trip/project structure lives in `meta` JSON; freeform detail and packing checklists live in entries.
- Promote only idea→project in v1.
- No separate List table or trip↔list FK.
