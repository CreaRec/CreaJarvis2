# ADR-002: Reminders (Postgres + poller + web toast)

- **Status:** Accepted
- **Date:** 2026-08-01

## Context

Jarvis needs timed reminders with natural-language scheduling, list/search/cancel/snooze, and a simple delivery path for the desktop voice client — without introducing Temporal or a separate worker fleet.

## Decision

### 1. Postgres as source of truth

- New `reminders` table (Prisma model `Reminder`) with `fireAt`, `status`, optional `recurrence` JSON, optional embedding for semantic search.
- Recurrence kinds: `daily`, `weekdays`, `weekly`, `every_n_days`, `every_n_hours`, optional `untilDate`.
- Not stored as memory `Fact` rows — reminders are schedule objects, not long-term biography.

### 2. Typed tools + LLM time resolution

Tools: `reminder_create`, `reminder_list`, `reminder_search`, `reminder_update`, `reminder_cancel`, `reminder_snooze`, `reminder_cancel_many`.

The Realtime model resolves relative phrases using `get_current_time` and `USER_TIMEZONE` / default part-of-day hours from config, then passes absolute ISO `fire_at` to tools.

### 3. In-process poller + DeviceRegistry

- `ReminderPoller` claims due rows (`FOR UPDATE SKIP LOCKED`) on an interval (`REMINDER_POLL_MS`).
- Delivery: broadcast Voice Gateway outbound events to **notifiable** connected devices (ADR-005):
  - `reminder.fired`
  - `reminder.missed_digest` (flush missed on device `hello`, household-level complete after broadcast)
- No Realtime proactive speech for reminders.
- Quiet hours defer delivery by shifting `fireAt`; short snooze may set `quietHoursOverride`.

### 4. Web toast + debug UI

- `clients/desktop` shows toasts/notifications on reminder events.
- Collapsible **Debug · Reminders** table loads `GET /debug/reminders` with `Authorization: Bearer <JARVIS_GATEWAY_TOKEN>`.

### 5. Not Temporal

Personal one-shot/recurring fire-at CRUD does not justify a Temporal cluster. Revisit if multi-step escalation / multi-channel workflows appear.

## Consequences

- Core must stay up for due delivery; missed reminders wait for next authenticated device `hello`.
- Protocol outbound types grow beyond ADR-001 (`reminder.fired`, `reminder.missed_digest`).
- Debug HTTP requires the household bearer token (ADR-005); CORS remains permissive for LAN clients that send auth.
