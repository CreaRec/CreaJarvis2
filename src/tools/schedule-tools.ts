import type { AppConfig } from "../config.js";
import { toPublic as eventToPublic, type EventStore } from "../events/store.js";
import { logger } from "../log.js";
import { toItemPublic, type PlanStore } from "../plans/store.js";
import { toPublic as reminderToPublic, type ReminderStore } from "../reminders/store.js";
import { classifyError, recordVoiceError } from "../telemetry.js";
import {
  dayEndUtc,
  dayStartUtc,
  isValidLocalDate,
  localDateString,
} from "../utils/time/index.js";
import { type ToolDefinition, z } from "./gateway.js";

type DateRange = {
  fromDate: string;
  toDate: string;
  from: Date;
  toExclusive: Date;
};

export function resolveScheduleDateRange(opts: {
  date?: string;
  from?: string;
  to?: string;
  timeZone: string;
  now?: Date;
  defaultToday?: boolean;
}): DateRange | null {
  const today = localDateString(opts.now ?? new Date(), opts.timeZone);
  const exact = opts.date?.trim();
  const requestedFrom = exact ?? opts.from?.trim();
  const requestedTo = exact ?? opts.to?.trim();

  if (!requestedFrom && !requestedTo && !opts.defaultToday) return null;

  const fromDate = requestedFrom ?? requestedTo ?? today;
  const toDate = requestedTo ?? requestedFrom ?? today;
  if (!isValidLocalDate(fromDate) || !isValidLocalDate(toDate)) {
    throw new Error("Invalid date; expected YYYY-MM-DD");
  }
  if (fromDate > toDate) {
    throw new Error("Invalid date range: from must not be after to");
  }
  return {
    fromDate,
    toDate,
    from: dayStartUtc(fromDate, opts.timeZone),
    toExclusive: dayEndUtc(toDate, opts.timeZone),
  };
}

export function createScheduleTools(deps: {
  reminders: ReminderStore;
  events: EventStore;
  plans: PlanStore;
  config: AppConfig;
}): ToolDefinition[] {
  return [
    {
      name: "schedule_search",
      description:
        "Unified agenda and search across day plans, reminders, and synced Apple Calendar events. For «что сегодня/завтра/на дату» pass date=YYYY-MM-DD and omit query. For topic search across all three sources pass query; optionally restrict it with date or from/to. Prefer this over calling plan_get, reminder_list, and calendar_list separately for a combined answer.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Optional topic/text to search in plans, reminders, and events",
          },
          date: {
            type: "string",
            description: "Exact local date YYYY-MM-DD",
          },
          from: {
            type: "string",
            description: "First local date YYYY-MM-DD, inclusive",
          },
          to: {
            type: "string",
            description: "Last local date YYYY-MM-DD, inclusive",
          },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
      },
      handler: async (raw) => {
        const schema = z.object({
          query: z.string().trim().min(1).optional(),
          date: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          limit: z.number().int().min(1).max(50).optional(),
        });
        const parsed = schema.safeParse(raw ?? {});
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }

        const started = Date.now();
        const query = parsed.data.query;
        const limit = parsed.data.limit ?? 30;
        let range: DateRange | null;
        try {
          range = resolveScheduleDateRange({
            date: parsed.data.date,
            from: parsed.data.from,
            to: parsed.data.to,
            timeZone: deps.config.USER_TIMEZONE,
            defaultToday: !query,
          });
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }

        try {
          const sourceLimit = Math.min(limit * 3, 150);
          const [planItems, reminders, events] = query
            ? await Promise.all([
                deps.plans.search(query, sourceLimit),
                deps.reminders.search(query, sourceLimit),
                deps.events.search(query, sourceLimit),
              ])
            : await Promise.all([
                deps.plans
                  .listRange(range!.fromDate, range!.toDate)
                  .then((plans) => plans.flatMap((plan) => plan.items)),
                deps.reminders.list({
                  from: range!.from,
                  to: new Date(range!.toExclusive.getTime() - 1),
                  limit: sourceLimit,
                }),
                deps.events.list({
                  from: range!.from,
                  to: new Date(range!.toExclusive.getTime() - 1),
                  limit: sourceLimit,
                }),
              ]);

          const inRange = (date: Date | null, localDate?: string): boolean => {
            if (!range) return true;
            if (localDate) {
              return localDate >= range.fromDate && localDate <= range.toDate;
            }
            return Boolean(
              date &&
                date.getTime() >= range.from.getTime() &&
                date.getTime() < range.toExclusive.getTime(),
            );
          };

          const visiblePlans = planItems.filter(
            (item) =>
              item.status !== "cancelled" &&
              inRange(item.scheduledAt, item.localDate),
          );
          const linkedReminderIds = new Set(
            visiblePlans
              .map((item) => item.reminderId)
              .filter((id): id is string => Boolean(id)),
          );

          const combined = [
            ...visiblePlans.map((item) => ({
              sortAt:
                item.scheduledAt?.getTime() ??
                dayStartUtc(item.localDate, item.timezone).getTime(),
              value: {
                ...toItemPublic(item),
                source: "plan" as const,
                date: item.localDate,
              },
            })),
            ...reminders
              .filter(
                (reminder) =>
                  !linkedReminderIds.has(reminder.id) &&
                  inRange(reminder.fireAt),
              )
              .map((reminder) => ({
                sortAt: reminder.fireAt.getTime(),
                value: {
                  ...reminderToPublic(reminder),
                  source: "reminder" as const,
                },
              })),
            ...events
              .filter((event) => inRange(event.startAt))
              .map((event) => ({
                sortAt: event.startAt.getTime(),
                value: {
                  ...eventToPublic(event),
                  source: "event" as const,
                  text: event.title,
                },
              })),
          ];

          combined.sort(
            (a, b) =>
              a.sortAt - b.sortAt ||
              a.value.source.localeCompare(b.value.source),
          );
          const items = combined.slice(0, limit).map(({ value }) => value);

          logger.info("[schedule] search", {
            component: "schedule",
            handler: "tool",
            step: "finish",
            tool: "schedule_search",
            result: "success",
            mode: query ? "query" : "agenda",
            count: items.length,
            duration_ms: Date.now() - started,
          });
          return {
            ok: true,
            data: {
              items,
              count: items.length,
              query: query ?? null,
              range: range
                ? { from: range.fromDate, to: range.toDate }
                : null,
            },
          };
        } catch (error) {
          const errorType = classifyError(error);
          recordVoiceError({ errorType, handler: "tool" });
          logger.exception("[schedule] search failed", error, {
            component: "schedule",
            handler: "tool",
            step: "finish",
            tool: "schedule_search",
            result: "error",
            mode: query ? "query" : "agenda",
            duration_ms: Date.now() - started,
            error_type: errorType,
          });
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    },
  ];
}
