import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBullMqQueue } from "@/server/jobs/drivers/bullmq";
import type { HandlerRegistry, JobQueue } from "@/server/jobs/queue";

// Redis-gated (D-020): skip cleanly on dev machines without Redis, always
// exercised in CI via a redis service container.
const REDIS_URL = process.env.REDIS_URL;

const QUEUE_NAME = "jobs";

/** Same shape `createBullMqQueue` actually returns: `JobQueue` plus a `close`
 *  method used for graceful shutdown / test teardown (not part of the public
 *  `JobQueue` interface). */
type TestableJobQueue = JobQueue & { close(): Promise<void> };

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitUntil(
  cond: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 25,
): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitUntil: condition not met within timeout");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function makeHandlers(
  syncItem: HandlerRegistry["sync-item"],
): HandlerRegistry {
  return {
    "sync-item": syncItem,
    "poll-stale-items": async () => {},
  };
}

describe.skipIf(!REDIS_URL)("bullmq driver (D-020)", () => {
  let inspect: Queue;
  let jobQueue: TestableJobQueue | undefined;

  beforeAll(async () => {
    inspect = new Queue(QUEUE_NAME, { connection: { url: REDIS_URL! } });
  });

  afterAll(async () => {
    await inspect.obliterate({ force: true });
    await inspect.close();
  });

  beforeEach(async () => {
    // isolate each test: no leftover jobs/schedulers from a previous run.
    await inspect.obliterate({ force: true });
  });

  afterEach(async () => {
    await jobQueue?.close();
    jobQueue = undefined;
  });

  it("runs the handler with the enqueued payload", async () => {
    const calls: Array<{ itemId: string; trigger: string }> = [];
    const handlers = makeHandlers(async (payload) => {
      calls.push(payload);
    });
    jobQueue = createBullMqQueue(handlers, REDIS_URL!) as TestableJobQueue;

    const payload = { itemId: `item-${randomUUID()}`, trigger: "MANUAL" as const };
    await jobQueue.enqueue("sync-item", payload);

    await waitUntil(() => calls.length === 1);
    expect(calls[0]).toEqual(payload);
  });

  it("collapses two enqueues sharing a dedupKey while the first is pending", async () => {
    const dedupKey = `dk-${randomUUID()}`;
    const jobId = `dedup:${dedupKey}`;
    const gate = deferred<void>();
    const started: string[] = [];
    const finished: string[] = [];
    const handlers = makeHandlers(async (payload) => {
      started.push(payload.itemId);
      await gate.promise;
      finished.push(payload.itemId);
    });
    jobQueue = createBullMqQueue(handlers, REDIS_URL!) as TestableJobQueue;

    await jobQueue.enqueue(
      "sync-item",
      { itemId: "item-a", trigger: "MANUAL" },
      { dedupKey },
    );
    await waitUntil(() => started.length === 1);

    // Second enqueue with the same dedupKey while the first is still held
    // (active, un-removed job hash) must be swallowed — no second handler run.
    await jobQueue.enqueue(
      "sync-item",
      { itemId: "item-b", trigger: "MANUAL" },
      { dedupKey },
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(started).toEqual(["item-a"]);

    gate.resolve();
    await waitUntil(() => finished.length === 1);
    // removeOnComplete frees the deterministic jobId once settled.
    await waitUntil(async () => (await inspect.getJob(jobId)) === undefined, 5000);
    expect(started).toEqual(["item-a"]);
  });

  it("runs again after a job with the same dedupKey has completed", async () => {
    const dedupKey = `dk-${randomUUID()}`;
    const jobId = `dedup:${dedupKey}`;
    const calls: string[] = [];
    const handlers = makeHandlers(async (payload) => {
      calls.push(payload.itemId);
    });
    jobQueue = createBullMqQueue(handlers, REDIS_URL!) as TestableJobQueue;

    await jobQueue.enqueue(
      "sync-item",
      { itemId: "first", trigger: "MANUAL" },
      { dedupKey },
    );
    await waitUntil(() => calls.length === 1);
    // wait for the job hash to be removed (removeOnComplete) so the id is free
    await waitUntil(async () => (await inspect.getJob(jobId)) === undefined);

    await jobQueue.enqueue(
      "sync-item",
      { itemId: "second", trigger: "MANUAL" },
      { dedupKey },
    );
    await waitUntil(() => calls.length === 2);
    expect(calls).toEqual(["first", "second"]);
  });

  it("runs again after a job with the same dedupKey has failed", async () => {
    const dedupKey = `dk-${randomUUID()}`;
    const jobId = `dedup:${dedupKey}`;
    const calls: string[] = [];
    const handlers = makeHandlers(async (payload) => {
      calls.push(payload.itemId);
      if (payload.itemId === "will-fail") {
        throw new Error("simulated handler failure");
      }
    });
    jobQueue = createBullMqQueue(handlers, REDIS_URL!) as TestableJobQueue;

    await jobQueue.enqueue(
      "sync-item",
      { itemId: "will-fail", trigger: "MANUAL" },
      { dedupKey },
    );
    await waitUntil(() => calls.length === 1);
    // wait for the job hash to be removed (removeOnFail) so the id is free
    await waitUntil(async () => (await inspect.getJob(jobId)) === undefined);

    await jobQueue.enqueue(
      "sync-item",
      { itemId: "will-succeed", trigger: "MANUAL" },
      { dedupKey },
    );
    await waitUntil(() => calls.length === 2);
    expect(calls).toEqual(["will-fail", "will-succeed"]);
  });
});
