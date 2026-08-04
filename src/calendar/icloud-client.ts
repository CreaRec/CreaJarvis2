import { createDAVClient, type DAVObject } from "tsdav";
import {
  buildVEventIcs,
  defaultEventEnd,
  parseFirstVEvent,
} from "./ics.js";

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
    input: CalendarEventInput,
  ): Promise<CalendarClientResult<{ uid: string; href: string; end: Date }>>;
  deleteEvent(href: string): Promise<CalendarClientResult<{ deleted: true }>>;
}

function joinHref(calendarUrl: string, filename: string): string {
  const base = calendarUrl.endsWith("/") ? calendarUrl : `${calendarUrl}/`;
  return new URL(filename, base).href;
}

type DavSession = Awaited<ReturnType<typeof createDAVClient>>;

function toIcsInput(input: CalendarEventInput, end: Date) {
  return {
    uid: input.uid,
    title: input.title,
    start: input.start,
    end,
    description: input.description,
    location: input.location,
    geo: input.geo,
    timeZone: input.timeZone,
  };
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

  async createEvent(
    input: CalendarEventInput,
  ): Promise<CalendarClientResult<{ uid: string; href: string; end: Date }>> {
    try {
      const end = defaultEventEnd(input.start, input.end);
      const iCalString = buildVEventIcs(toIcsInput(input, end));
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
    input: CalendarEventInput,
  ): Promise<CalendarClientResult<{ uid: string; href: string; end: Date }>> {
    try {
      const end = defaultEventEnd(input.start, input.end);
      const iCalString = buildVEventIcs(toIcsInput(input, end));
      const client = await this.getClient();
      await client.updateCalendarObject({
        calendarObject: {
          url: href,
          data: iCalString,
        },
      });
      return { ok: true, data: { uid: input.uid, href, end } };
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
