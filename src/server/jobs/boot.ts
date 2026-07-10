import "server-only";
import { logger } from "@/server/lib/logger";
import { getQueue } from "./index";

const POLL_EVERY_MS = 6 * 60 * 60 * 1000;

const globalForBoot = globalThis as unknown as { jobsBooted?: boolean };

/** Called once per server process from instrumentation.ts. */
export function startBackgroundJobs(): void {
  if (globalForBoot.jobsBooted) return;
  globalForBoot.jobsBooted = true;

  const queue = getQueue();
  queue.schedule("poll-stale-items", POLL_EVERY_MS);
  // catch up once at boot so a long-stopped dev server heals immediately
  void queue.enqueue("poll-stale-items", {}, { dedupKey: "scheduled:poll-stale-items" });
  logger.info({ pollEveryMs: POLL_EVERY_MS }, "background jobs started");
}
