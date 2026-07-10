import { describe, expect, it, vi } from "vitest";
import { createInProcessQueue } from "@/server/jobs/drivers/in-process";
import type { HandlerRegistry } from "@/server/jobs/queue";

function flushImmediates() {
  return new Promise<void>((resolve) => setImmediate(() => setImmediate(resolve)));
}

function makeRegistry(overrides: Partial<HandlerRegistry> = {}): HandlerRegistry {
  return {
    "sync-item": vi.fn().mockResolvedValue(undefined),
    "poll-stale-items": vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("in-process queue", () => {
  it("runs enqueued jobs with their payload", async () => {
    const handlers = makeRegistry();
    const queue = createInProcessQueue(handlers);
    await queue.enqueue("sync-item", { itemId: "i1", trigger: "MANUAL" });
    await flushImmediates();
    expect(handlers["sync-item"]).toHaveBeenCalledWith({ itemId: "i1", trigger: "MANUAL" });
  });

  it("collapses concurrent jobs sharing a dedup key", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = vi.fn().mockImplementation(() => gate);
    const handlers = makeRegistry({ "sync-item": slow });
    const queue = createInProcessQueue(handlers);

    await queue.enqueue("sync-item", { itemId: "i1", trigger: "WEBHOOK" }, { dedupKey: "k" });
    await flushImmediates();
    await queue.enqueue("sync-item", { itemId: "i1", trigger: "WEBHOOK" }, { dedupKey: "k" });
    await queue.enqueue("sync-item", { itemId: "i1", trigger: "WEBHOOK" }, { dedupKey: "k" });
    release();
    await flushImmediates();
    expect(slow).toHaveBeenCalledTimes(1);

    // after completion the key frees up
    await queue.enqueue("sync-item", { itemId: "i1", trigger: "WEBHOOK" }, { dedupKey: "k" });
    await flushImmediates();
    expect(slow).toHaveBeenCalledTimes(2);
  });

  it("a failing job logs and releases its dedup key", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("boom"));
    const handlers = makeRegistry({ "sync-item": failing });
    const queue = createInProcessQueue(handlers);
    await queue.enqueue("sync-item", { itemId: "i1", trigger: "MANUAL" }, { dedupKey: "k" });
    await flushImmediates();
    await queue.enqueue("sync-item", { itemId: "i1", trigger: "MANUAL" }, { dedupKey: "k" });
    await flushImmediates();
    expect(failing).toHaveBeenCalledTimes(2);
  });
});
