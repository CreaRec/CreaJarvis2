export type ReminderAppleSyncStatus = "pending" | "synced" | "failed";

export type Recurrence =
  | { kind: "daily"; untilDate?: string }
  | { kind: "weekdays"; untilDate?: string }
  | { kind: "weekly"; days: number[]; untilDate?: string }
  | { kind: "every_n_days"; n: number; untilDate?: string }
  | { kind: "every_n_hours"; n: number; untilDate?: string };

export interface ReminderRecord {
  id: string;
  text: string;
  fireAt: Date;
  timezone: string;
  rawUtterance: string | null;
  recurrence: Recurrence | null;
  appleSyncStatus: ReminderAppleSyncStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewReminder {
  text: string;
  fireAt: Date;
  timezone: string;
  rawUtterance?: string | null;
  recurrence?: Recurrence | null;
  appleSyncStatus?: ReminderAppleSyncStatus;
}

export interface ReminderPublic {
  id: string;
  text: string;
  fire_at_iso: string;
  fire_at_local: string;
  recurrence: Recurrence | null;
  raw_utterance: string | null;
  timezone: string;
  created_at: string;
  apple_sync_status: ReminderAppleSyncStatus;
}
