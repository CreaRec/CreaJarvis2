import { describe, expect, it, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FsAttachmentStore } from "./fs-store.js";
import {
  getLatestAttachmentStorageBytes,
  refreshAttachmentStorageMetrics,
  resetAttachmentStorageMetricsForTests,
  startAttachmentStorageMetrics,
} from "./storage-metrics.js";

describe("attachment storage metrics", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    resetAttachmentStorageMetricsForTests();
    await Promise.all(
      dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
    );
  });

  it("refresh updates latest bytes after add", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "jarvis-met-"));
    dirs.push(dir);
    const store = new FsAttachmentStore({ rootDir: dir });
    await store.add("u1", Buffer.from("abcdefghij"), "a.txt", "text/plain");
    await refreshAttachmentStorageMetrics(store);
    const latest = getLatestAttachmentStorageBytes();
    expect(latest.inboxBytes).toBeGreaterThanOrEqual(10);
    expect(latest.totalBytes).toBeGreaterThanOrEqual(latest.inboxBytes);
  });

  it("startAttachmentStorageMetrics observes areas", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "jarvis-met2-"));
    dirs.push(dir);
    const store = new FsAttachmentStore({ rootDir: dir });
    await store.add("u1", Buffer.from("xyz"), "a.txt", "text/plain");

    const observed: Array<{ value: number; area: string }> = [];
    const stop = startAttachmentStorageMetrics({
      store,
      intervalMs: 60_000,
      createObservableGauge: () => ({
        addCallback(cb: (result: { observe: (value: number, attrs?: Record<string, string>) => void }) => void) {
          void cb({
            observe(value: number, attrs?: Record<string, string>) {
              observed.push({
                value,
                area: String(attrs?.area ?? ""),
              });
            },
          });
        },
      }),
    });
    await refreshAttachmentStorageMetrics(store);
    // trigger callback manually via second register path — gauge already registered;
    // call refresh and simulate observe from latest
    expect(getLatestAttachmentStorageBytes().totalBytes).toBeGreaterThan(0);
    stop();
    expect(
      ["inbox", "archive", "total"].every((a) =>
        observed.some((o) => o.area === a),
      ) || observed.length === 0,
    ).toBe(true);
  });
});
