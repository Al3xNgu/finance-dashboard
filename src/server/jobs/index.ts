import "server-only";
import { env } from "@/server/lib/env";
import { syncItemHandler } from "./handlers/sync-item";
import { pollStaleItemsHandler } from "./handlers/poll-stale-items";
import { createInProcessQueue } from "./drivers/in-process";
import { createBullMqQueue } from "./drivers/bullmq";
import type { HandlerRegistry, JobQueue } from "./queue";

const handlers: HandlerRegistry = {
  "sync-item": syncItemHandler,
  "poll-stale-items": pollStaleItemsHandler,
};

const globalForQueue = globalThis as unknown as { jobQueue?: JobQueue };

export function getQueue(): JobQueue {
  if (!globalForQueue.jobQueue) {
    if (env.QUEUE_DRIVER === "bullmq") {
      // Production driver (M8, D-020/closes D-017). REDIS_URL presence is
      // guaranteed by env validation when QUEUE_DRIVER=bullmq.
      globalForQueue.jobQueue = createBullMqQueue(
        handlers,
        env.REDIS_URL!,
        env.QUEUE_ROLE,
      );
    } else {
      globalForQueue.jobQueue = createInProcessQueue(handlers);
    }
  }
  return globalForQueue.jobQueue;
}

export type { JobQueue } from "./queue";
