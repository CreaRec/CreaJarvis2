export interface InboxItem {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Absolute or store-relative path to bytes. */
  storagePath: string;
  createdAt: string;
}

export interface InboxStatus {
  count: number;
  totalBytes: number;
  items: InboxItem[];
}

export interface ArchivePromoteResult {
  attachmentId: string;
  storagePath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface AttachmentStore {
  add(
    userId: string,
    bytes: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<InboxStatus>;
  status(userId: string): Promise<InboxStatus>;
  readAll(
    userId: string,
  ): Promise<Array<InboxItem & { bytes: Buffer }>>;
  /** Clear pending: rename leftovers to abandoned/, empty manifest. No unlink. */
  clearPending(userId: string): Promise<void>;
  /**
   * Move each pending inbox file into archive/{userId}/{attachmentId}.
   * Returns metadata; caller persists DB rows.
   */
  promoteAllToArchive(
    userId: string,
  ): Promise<ArchivePromoteResult[]>;
  readArchiveFile(storagePath: string): Promise<Buffer>;
  /** Sum bytes under root (inbox + archive). */
  measureDiskUsage(): Promise<{
    inboxBytes: number;
    archiveBytes: number;
    totalBytes: number;
  }>;
}
