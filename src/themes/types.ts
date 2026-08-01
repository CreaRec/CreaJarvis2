export type ThemeKind = "idea" | "project" | "trip" | "list";
export type ThemeStatus = "active" | "on_hold" | "done" | "archived";
export type ThemeEntryKind =
  | "note"
  | "question"
  | "decision"
  | "checklist"
  | "link";
export type ThemeEntryStatus = "open" | "done" | "cancelled";

export interface ThemeEntryRecord {
  id: string;
  themeId: string;
  kind: ThemeEntryKind;
  status: ThemeEntryStatus;
  text: string;
  rawUtterance: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ThemeRecord {
  id: string;
  kind: ThemeKind;
  title: string;
  status: ThemeStatus;
  summary: string | null;
  meta: Record<string, unknown> | null;
  rawUtterance: string | null;
  lastTouchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  entries: ThemeEntryRecord[];
}

export interface NewThemeInput {
  kind: ThemeKind;
  title: string;
  summary?: string | null;
  meta?: Record<string, unknown> | null;
  rawUtterance?: string | null;
  firstEntry?: {
    text: string;
    kind?: ThemeEntryKind;
    rawUtterance?: string | null;
  } | null;
}

export interface ThemeEntryPublic {
  id: string;
  kind: ThemeEntryKind;
  status: ThemeEntryStatus;
  text: string;
  raw_utterance: string | null;
  created_at: string;
}

export interface ThemePublic {
  id: string;
  kind: ThemeKind;
  title: string;
  status: ThemeStatus;
  summary: string | null;
  meta: Record<string, unknown> | null;
  raw_utterance: string | null;
  last_touched_at: string;
  created_at: string;
  entries: ThemeEntryPublic[];
}

export interface ThemeDebugRow {
  kind: ThemeKind;
  status: ThemeStatus;
  title: string;
  entry_text: string | null;
  entry_kind: ThemeEntryKind | null;
  entry_status: ThemeEntryStatus | null;
  id: string;
  entry_id: string | null;
  last_touched_at: string;
}
