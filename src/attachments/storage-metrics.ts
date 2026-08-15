import { logger } from "../log.js";
import { classifyError } from "../telemetry.js";
import type { AttachmentStore } from "./types.js";

export type StorageArea = "inbox" | "archive" | "total";

type ObserveFn = (
  value: number,
  attributes?: Record<string, string>,
) => void;

type GaugeLike = {
  addCallback: (cb: (result: { observe: ObserveFn }) => void) => void;
};

let latest = { inboxBytes: 0, archiveBytes: 0, totalBytes: 0 };
let gaugeRegistered = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function getLatestAttachmentStorageBytes(): typeof latest {
  return { ...latest };
}

export async function refreshAttachmentStorageMetrics(
  store: AttachmentStore,
): Promise<void> {
  try {
    latest = await store.measureDiskUsage();
  } catch (err) {
    logger.exception("[attachments] storage measure failed", err, {
      component: "attachments",
      handler: "http",
      step: "storage_metric",
      result: "error",
      error_type: classifyError(err),
    });
  }
}

/**
 * Register ObservableGauge attachment_storage_bytes and optional periodic refresh.
 * Telemetry failures must not throw.
 */
export function startAttachmentStorageMetrics(input: {
  store: AttachmentStore;
  createObservableGauge?: (
    name: string,
    opts: { description: string },
  ) => GaugeLike;
  intervalMs: number;
}): () => void {
  const { store, intervalMs } = input;

  try {
    if (!gaugeRegistered && input.createObservableGauge) {
      const gauge = input.createObservableGauge("attachment_storage_bytes", {
        description: "Bytes used by Core attachment inbox/archive on disk",
      });
      gauge.addCallback((result) => {
        result.observe(latest.inboxBytes, { area: "inbox" });
        result.observe(latest.archiveBytes, { area: "archive" });
        result.observe(latest.totalBytes, { area: "total" });
      });
      gaugeRegistered = true;
    }
  } catch (err) {
    logger.warn("[attachments] gauge register failed", {
      component: "attachments",
      error_message: err instanceof Error ? err.message : String(err),
    });
  }

  void refreshAttachmentStorageMetrics(store);
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(() => {
    void refreshAttachmentStorageMetrics(store);
  }, intervalMs);
  intervalHandle.unref?.();

  return () => {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  };
}

/** Test helper to reset module state. */
export function resetAttachmentStorageMetricsForTests(): void {
  latest = { inboxBytes: 0, archiveBytes: 0, totalBytes: 0 };
  gaugeRegistered = false;
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
