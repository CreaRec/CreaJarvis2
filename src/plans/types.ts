import type { Recurrence } from "../reminders/types.js";

export type PlanItemStatus = "open" | "done" | "cancelled";

export interface PlanItemRecord {
  id: string;
  planId: string;
  localDate: string;
  text: string;
  status: PlanItemStatus;
  sortOrder: number;
  scheduledAt: Date | null;
  reminderId: string | null;
  recurrence: Recurrence | null;
  rawUtterance: string | null;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DayPlanRecord {
  id: string;
  localDate: string;
  timezone: string;
  items: PlanItemRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface NewPlanItemInput {
  text: string;
  scheduledAt?: Date | null;
  /** When true (or when scheduledAt is set), create a linked Reminder. */
  remind?: boolean;
  recurrence?: Recurrence | null;
  rawUtterance?: string | null;
  sortOrder?: number;
}

export interface PlanItemPublic {
  id: string;
  text: string;
  status: PlanItemStatus;
  sort_order: number;
  scheduled_at_iso: string | null;
  scheduled_at_local: string | null;
  has_reminder: boolean;
  reminder_id: string | null;
  recurrence: Recurrence | null;
  raw_utterance: string | null;
}

export interface DayPlanPublic {
  date: string;
  timezone: string;
  items: PlanItemPublic[];
}
