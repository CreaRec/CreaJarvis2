export interface EventRecord {
  id: string;
  uid: string;
  href: string;
  title: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  notes: string | null;
  alarmMinutesBefore: number[] | null;
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
  href: string;
  title: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  notes?: string | null;
  alarmMinutesBefore?: number[] | null;
  locationName?: string | null;
  locationAddress?: string | null;
  locationMapsUrl?: string | null;
  locationLat?: number | null;
  locationLon?: number | null;
}

export interface EventPublic {
  id: string;
  event_uid: string;
  title: string;
  start_iso: string;
  end_iso: string;
  start_local: string;
  end_local: string;
  timezone: string;
  notes: string | null;
  alarm_minutes_before: number[] | null;
  location_name: string | null;
  location_address: string | null;
  location_maps_url: string | null;
  location_lat: number | null;
  location_lon: number | null;
  created_at: string;
}
