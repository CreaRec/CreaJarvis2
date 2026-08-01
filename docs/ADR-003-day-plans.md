# ADR-003: Day plans (agenda per local date)

- **Status:** Accepted
- **Date:** 2026-08-01

## Context

Jarvis needs a daily agenda distinct from long-term memory facts and from one-shot timed reminders: «план на сегодня», mark done, carry unfinished to tomorrow, optional clock times.

## Decision

### 1. DayPlan + PlanItem in Postgres

- `day_plans.localDate` (`YYYY-MM-DD` in `USER_TIMEZONE`), unique.
- `plan_items` with status `open|done|cancelled`, optional `scheduledAt`, soft-linked `reminderId`, optional recurrence JSON.

### 2. Timed items link to Reminder

- Creating/updating an item with `scheduledAt` creates or updates a `Reminder` (same toast poller as ADR-002).
- Completing or cancelling the item cancels the linked reminder.
- Untimed items never create reminders.

### 3. Tools + instructions

`plan_set`, `plan_add`, `plan_get`, `plan_search`, `plan_update_item`, `plan_complete_item`, `plan_cancel_item`, `plan_move_item`, `plan_carry_over`, `plan_clear`.

Session instructions separate memory / reminders / day plans.

### 4. Connect digest

On Voice Gateway `ready`, if there are open items for today, send `plan.today_digest` for a web-ptt toast. No separate plan poller.

### 5. Debug

`GET /debug/plans` + **Debug · Plans** collapsible table in web-ptt.

## Consequences

- Carry-over is explicit (`plan_carry_over`), not automatic at night.
- Reminder cancel is best-effort if `reminderId` points at a missing row.
- Recurring plan items spawn the next occurrence on complete.
