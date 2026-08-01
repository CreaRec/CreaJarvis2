import type {
  MemoryBranch,
  MemoryConfidence,
  MemorySensitivity,
} from "@prisma/client";

export type { MemoryBranch, MemoryConfidence, MemorySensitivity };

export interface MemoryFact {
  id: string;
  branch: MemoryBranch;
  topic: string;
  text: string;
  confidence: MemoryConfidence;
  sensitivity: MemorySensitivity;
  source: string;
  contentHash: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewFact {
  branch: MemoryBranch;
  topic?: string;
  text: string;
  confidence?: MemoryConfidence;
  sensitivity?: MemorySensitivity;
  source?: string;
  contentHash: string;
}

export interface RankedHit {
  id: string;
  score: number;
}

export interface SearchParams {
  query: string;
  branch?: MemoryBranch;
  limit?: number;
}

export interface MemoryRetriever {
  search(params: SearchParams): Promise<RankedHit[]>;
  index(id: string): Promise<void>;
}
