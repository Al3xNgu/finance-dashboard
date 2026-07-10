import "server-only";
import { env } from "@/server/lib/env";
import { syncItemHandler } from "./handlers/sync-item";
import { pollStaleItemsHandler } from "./handlers/poll-stale-items";
import { createInProcessQueue } from "./drivers/in-process";
import type { HandlerRegistry, JobQueue } from "./queue";

const handlers: HandlerRegistry = {
  "sync-item": syncItemHandler,
  "poll-stale-items": pollStaleItemsHandler,
};

const globalForQueue = globalThis as unknown as { jobQueue?: JobQueue };

export function getQueue(): JobQueue {
  if (!globalForQueue.jobQueue) {
    if (env.QUEUE_DRIVER === "bullmq") {
      // Production driver lands with M8 (deployment config) — D-017.
      throw new Error("bullmq queue driver is not implemented yet");
    }
    globalForQueue.jobQueue = createInProcessQueue(handlers);
  }
  return globalForQueue.jobQueue;
}

export type { JobQueue } from "./queue";
