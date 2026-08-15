export interface EventRecord {
  id: string;
  uid: string;
  /** Empty string for master / non-recurring; RECURRENCE-ID for exceptions. */
  recurrenceId: string;
  href: string;
  title: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  notes: string | null;
  alarmMinutesBefore: number[] | null;
  recurrenceRule: string | null;
  isAllDay: boolean;
  sourceUpdatedAt: Date | null;
  lastSeenSyncId: string | null;
  locationName: string | null;
  locationAddress: string | null;
  locationMapsUrl: string | null;
  locationLat: number | null;
  locationLon: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewEvent {
  uid: string;
  recurrenceId?: string;
  href: string;
  title: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  notes?: string | null;
  alarmMinutesBefore?: number[] | null;
  recurrenceRule?: string | null;
  isAllDay?: boolean;
  sourceUpdatedAt?: Date | null;
  lastSeenSyncId?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  locationMapsUrl?: string | null;
  locationLat?: number | null;
  locationLon?: number | null;
}

export interface EventPublic {
  id: string;
  event_uid: string;
  recurrence_id: string | null;
  title: string;
  start_iso: string;
  end_iso: string;
  start_local: string;
  end_local: string;
  timezone: string;
  is_all_day: boolean;
  recurrence_rule: string | null;
  notes: string | null;
  alarm_minutes_before: number[] | null;
  location_name: string | null;
  location_address: string | null;
  location_maps_url: string | null;
  location_lat: number | null;
  location_lon: number | null;
  created_at: string;
}

/** Normalize nullable recurrence id to DB sentinel. */
export function normalizeRecurrenceId(value: string | null | undefined): string {
  return value?.trim() ? value.trim() : "";
}

export function publicRecurrenceId(value: string): string | null {
  return value.length > 0 ? value : null;
}
