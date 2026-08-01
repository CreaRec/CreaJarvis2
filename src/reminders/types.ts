export type ReminderStatus =
  | "pending"
  | "delivering"
  | "delivered"
  | "missed"
  | "cancelled"
  | "snoozed";

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
  status: ReminderStatus;
  rawUtterance: string | null;
  recurrence: Recurrence | null;
  quietHoursOverride: boolean | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewReminder {
  text: string;
  fireAt: Date;
  timezone: string;
  rawUtterance?: string | null;
  recurrence?: Recurrence | null;
  quietHoursOverride?: boolean | null;
  status?: ReminderStatus;
}

export interface ReminderPublic {
  id: string;
  text: string;
  fire_at_iso: string;
  fire_at_local: string;
  status: ReminderStatus;
  recurrence: Recurrence | null;
  raw_utterance: string | null;
  timezone: string;
  delivered_at: string | null;
  created_at: string;
}
