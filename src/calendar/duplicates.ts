import { formatLocal } from "../utils/time/index.js";

export type DuplicateReason = "time_overlap" | "similar_same_day";

export const ON_DUPLICATE_CHOICES = ["skip", "replace", "keep_both"] as const;
export type OnDuplicate = (typeof ON_DUPLICATE_CHOICES)[number];

const STOPWORDS = new Set([
  "appointment",
  "appt",
  "checkup",
  "check",
  "visit",
  "meeting",
  "event",
  "with",
  "from",
  "this",
  "that",
  "your",
  "office",
  "clinic",
  "center",
  "doctor",
  "аппоинтмент",
  "встреча",
  "прием",
  "приём",
  "доктор",
  "врача",
  "врач",
]);

export type DuplicateEventInput = {
  uid: string;
  href: string;
  event_id?: string | null;
  title: string;
  location?: string | null;
  start: Date | null;
  end: Date | null;
  isAllDay?: boolean;
};

export type DuplicateCandidate = {
  uid: string;
  href: string;
  event_id: string | null;
  title: string;
  location: string | null;
  start_iso: string | null;
  end_iso: string | null;
  start_local: string | null;
  end_local: string | null;
  reasons: DuplicateReason[];
};

export function eventTextTokens(...parts: Array<string | null | undefined>): Set<string> {
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  const tokens = text
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
  return new Set(tokens);
}

export function tokensOverlap(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  for (const token of a) {
    if (b.has(token)) return true;
  }
  return false;
}

export function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

export function findDuplicateCandidates(opts: {
  title: string;
  location?: string | null;
  start: Date;
  end: Date;
  timeZone: string;
  events: DuplicateEventInput[];
}): DuplicateCandidate[] {
  const proposedTokens = eventTextTokens(opts.title, opts.location);
  const out: DuplicateCandidate[] = [];

  for (const event of opts.events) {
    const reasons: DuplicateReason[] = [];
    const timed =
      event.start &&
      event.end &&
      !event.isAllDay &&
      intervalsOverlap(opts.start, opts.end, event.start, event.end);
    if (timed) reasons.push("time_overlap");

    const existingTokens = eventTextTokens(event.title, event.location);
    if (tokensOverlap(proposedTokens, existingTokens)) {
      reasons.push("similar_same_day");
    }

    if (reasons.length === 0) continue;
    out.push({
      uid: event.uid,
      href: event.href,
      event_id: event.event_id ?? null,
      title: event.title,
      location: event.location ?? null,
      start_iso: event.start ? event.start.toISOString() : null,
      end_iso: event.end ? event.end.toISOString() : null,
      start_local: event.start ? formatLocal(event.start, opts.timeZone) : null,
      end_local: event.end ? formatLocal(event.end, opts.timeZone) : null,
      reasons,
    });
  }

  return out;
}
