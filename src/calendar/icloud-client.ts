import { createDAVClient, type DAVObject } from "tsdav";
import {
  buildVEventIcs,
  defaultEventEnd,
  parseFirstVEvent,
  replaceValarmsInIcs,
  resolveAlarmMinutes,
  type ParsedCalendarEvent,
} from "./ics.js";
import { mergeEventDescription } from "./event-description.js";

export type CalendarClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface CalendarEventInput {
  uid: string;
  title: string;
  start: Date;
  end?: Date;
  description?: string;
  location?: string;
  geo?: { lat: number; lon: number };
  timeZone: string;
  /**
   * Minutes before start for DISPLAY VALARMs.
   * Create: omitted → defaults. Update: omitted → preserve from CalDAV.
   * Pass `[]` for no alarms.
   */
  alarmMinutesBefore?: number[];
}

/**
 * Partial update. Omitted fields are preserved from the existing CalDAV object.
 * Alarm-only patches surgically replace VALARMs without rewriting DTSTART/DTEND.
 */
export interface CalendarEventPatch {
  uid: string;
  timeZone: string;
  title?: string;
  start?: Date;
  end?: Date;
  description?: string;
  /**
   * When set (including null), merge into DESCRIPTION: keep existing free-text
   * notes (unless `description` is also set) and ensure this Maps URL is present.
   */
  mapsUrl?: string | null;
  location?: string;
  geo?: { lat: number; lon: number };
  alarmMinutesBefore?: number[];
}

export interface CalendarEventListItem {
  uid: string;
  href: string;
  title: string;
  start: string | null;
  end: string | null;
  notes: string | null;
  location: string | null;
  geo: { lat: number; lon: number } | null;
}

export interface ICloudCalendarClient {
  createEvent(
    input: CalendarEventInput,
  ): Promise<CalendarClientResult<{ uid: string; href: string; end: Date }>>;
  listEvents(opts: {
    from: Date;
    to: Date;
    limit?: number;
  }): Promise<CalendarClientResult<{ events: CalendarEventListItem[] }>>;
  updateEvent(
    href: string,
    patch: CalendarEventPatch,
  ): Promise<CalendarClientResult<{ uid: string; href: string; end: Date }>>;
  deleteEvent(href: string): Promise<CalendarClientResult<{ deleted: true }>>;
}

function joinHref(calendarUrl: string, filename: string): string {
  const base = calendarUrl.endsWith("/") ? calendarUrl : `${calendarUrl}/`;
  return new URL(filename, base).href;
}

type DavSession = Awaited<ReturnType<typeof createDAVClient>>;

function toIcsInput(
  input: {
    uid: string;
    title: string;
    start: Date;
    description?: string;
    location?: string;
    geo?: { lat: number; lon: number };
    timeZone: string;
  },
  end: Date,
  alarmMinutesBefore: number[],
) {
  return {
    uid: input.uid,
    title: input.title,
    start: input.start,
    end,
    description: input.description,
    location: input.location,
    geo: input.geo,
    timeZone: input.timeZone,
    alarmMinutesBefore,
  };
}

function isAlarmsOnlyPatch(patch: CalendarEventPatch): boolean {
  return (
    patch.alarmMinutesBefore !== undefined &&
    patch.title === undefined &&
    patch.start === undefined &&
    patch.end === undefined &&
    patch.description === undefined &&
    patch.mapsUrl === undefined &&
    patch.location === undefined &&
    patch.geo === undefined
  );
}

export class TsdavICloudCalendarClient implements ICloudCalendarClient {
  private client: DavSession | null = null;

  constructor(
    private readonly username: string,
    private readonly password: string,
    private readonly calendarUrl: string,
  ) {}

  private async getClient(): Promise<DavSession> {
    if (this.client) return this.client;
    const client = await createDAVClient({
      serverUrl: "https://caldav.icloud.com",
      credentials: {
        username: this.username,
        password: this.password,
      },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });
    this.client = client;
    return client;
  }

  private calendarRef() {
    return { url: this.calendarUrl };
  }

  private async fetchExistingObject(
    href: string,
  ): Promise<{ raw: string; parsed: ParsedCalendarEvent } | null> {
    try {
      const client = await this.getClient();
      const objects = await client.fetchCalendarObjects({
        calendar: this.calendarRef(),
        objectUrls: [href],
      });
      const raw = (objects as DAVObject[])[0]?.data;
      if (typeof raw !== "string" || !raw.trim()) return null;
      const parsed = parseFirstVEvent(raw);
      if (!parsed) return null;
      return { raw, parsed };
    } catch {
      return null;
    }
  }

  async createEvent(
    input: CalendarEventInput,
  ): Promise<CalendarClientResult<{ uid: string; href: string; end: Date }>> {
    try {
      const end = defaultEventEnd(input.start, input.end);
      const alarms = resolveAlarmMinutes(input.alarmMinutesBefore);
      const iCalString = buildVEventIcs(toIcsInput(input, end, alarms));
      const filename = `${input.uid}.ics`;
      const client = await this.getClient();
      await client.createCalendarObject({
        calendar: this.calendarRef(),
        filename,
        iCalString,
      });
      return {
        ok: true,
        data: {
          uid: input.uid,
          href: joinHref(this.calendarUrl, filename),
          end,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async listEvents(opts: {
    from: Date;
    to: Date;
    limit?: number;
  }): Promise<CalendarClientResult<{ events: CalendarEventListItem[] }>> {
    try {
      const client = await this.getClient();
      const objects = await client.fetchCalendarObjects({
        calendar: this.calendarRef(),
        timeRange: {
          start: opts.from.toISOString(),
          end: opts.to.toISOString(),
        },
      });
      const limit = opts.limit ?? 50;
      const events: CalendarEventListItem[] = [];
      for (const obj of objects as DAVObject[]) {
        if (events.length >= limit) break;
        const raw = obj.data;
        if (typeof raw !== "string" || !raw.trim()) continue;
        const parsed = parseFirstVEvent(raw);
        if (!parsed) continue;
        events.push({
          uid: parsed.uid,
          href: obj.url,
          title: parsed.title,
          start: parsed.start?.toISOString() ?? null,
          end: parsed.end?.toISOString() ?? null,
          notes: parsed.notes,
          location: parsed.location,
          geo: parsed.geo,
        });
      }
      return { ok: true, data: { events } };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async updateEvent(
    href: string,
    patch: CalendarEventPatch,
  ): Promise<CalendarClientResult<{ uid: string; href: string; end: Date }>> {
    try {
      const existing = await this.fetchExistingObject(href);

      // Alarm-only: surgically replace VALARMs so DTSTART/DTEND stay intact.
      if (isAlarmsOnlyPatch(patch)) {
        if (!existing) {
          return {
            ok: false,
            error: "Could not fetch existing calendar event to update alarms",
          };
        }
        const iCalString = replaceValarmsInIcs(
          existing.raw,
          patch.alarmMinutesBefore!,
        );
        const client = await this.getClient();
        await client.updateCalendarObject({
          calendarObject: { url: href, data: iCalString },
        });
        const end =
          existing.parsed.end ??
          (existing.parsed.start
            ? defaultEventEnd(existing.parsed.start)
            : new Date());
        return { ok: true, data: { uid: patch.uid, href, end } };
      }

      const title = patch.title ?? existing?.parsed.title;
      const start = patch.start ?? existing?.parsed.start ?? undefined;
      if (!title || !start) {
        return {
          ok: false,
          error: "Calendar update requires title and start",
        };
      }

      let end: Date;
      if (patch.end) {
        end = patch.end;
      } else if (
        existing?.parsed.start &&
        existing.parsed.end &&
        existing.parsed.end.getTime() > existing.parsed.start.getTime()
      ) {
        const durationMs =
          existing.parsed.end.getTime() - existing.parsed.start.getTime();
        end = new Date(
          (patch.start ?? existing.parsed.start).getTime() + durationMs,
        );
      } else {
        end = defaultEventEnd(start, patch.end);
      }

      const description =
        patch.description !== undefined
          ? patch.description
          : patch.mapsUrl !== undefined
            ? mergeEventDescription({
                existingDescription: existing?.parsed.notes,
                mapsUrl: patch.mapsUrl,
              })
            : (existing?.parsed.notes ?? undefined);
      const location =
        patch.location !== undefined
          ? patch.location
          : (existing?.parsed.location ?? undefined);
      const geo =
        patch.geo !== undefined
          ? patch.geo
          : (existing?.parsed.geo ?? undefined);

      const alarms = resolveAlarmMinutes(
        patch.alarmMinutesBefore,
        existing?.parsed.alarmMinutesBefore ?? null,
      );

      const iCalString = buildVEventIcs(
        toIcsInput(
          {
            uid: patch.uid,
            title,
            start,
            description: description || undefined,
            location: location || undefined,
            geo: geo || undefined,
            timeZone: patch.timeZone,
          },
          end,
          alarms,
        ),
      );
      const client = await this.getClient();
      await client.updateCalendarObject({
        calendarObject: {
          url: href,
          data: iCalString,
        },
      });
      return { ok: true, data: { uid: patch.uid, href, end } };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async deleteEvent(
    href: string,
  ): Promise<CalendarClientResult<{ deleted: true }>> {
    try {
      const client = await this.getClient();
      await client.deleteCalendarObject({
        calendarObject: { url: href },
      });
      return { ok: true, data: { deleted: true } };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
