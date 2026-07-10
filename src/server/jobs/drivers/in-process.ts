import "server-only";
import { randomUUID } from "node:crypto";
import { logger } from "@/server/lib/logger";
import type {
  EnqueueOptions,
  HandlerRegistry,
  JobName,
  JobPayloads,
  JobQueue,
} from "../queue";

/**
 * Dev driver: runs handlers on the next tick in this process. Dedup collapses
 * concurrent enqueues of the same key; a failed job logs and drops (the
 * fallback poller re-enqueues stale items, so nothing is lost permanently).
 */
export function createInProcessQueue(handlers: HandlerRegistry): JobQueue {
  const inFlight = new Set<string>();
  const timers: ReturnType<typeof setInterval>[] = [];

  async function run<N extends JobName>(
    name: N,
    payload: JobPayloads[N],
    dedupKey: string,
  ): Promise<void> {
    const jobId = `job_${randomUUID()}`;
    const jobLog = logger.child({ jobId, job: name });
    try {
      jobLog.info("job started");
      await handlers[name](payload);
      jobLog.info("job finished");
    } catch (err) {
      jobLog.error({ err }, "job failed");
    } finally {
      inFlight.delete(dedupKey);
    }
  }

  return {
    async enqueue(name, payload, opts?: EnqueueOptions) {
      const dedupKey = opts?.dedupKey ?? `nodedup_${randomUUID()}`;
      if (inFlight.has(dedupKey)) {
        logger.debug({ job: name, dedupKey }, "job deduplicated");
        return;
      }
      inFlight.add(dedupKey);
      setImmediate(() => void run(name, payload, dedupKey));
    },

    schedule(name, everyMs) {
      const timer = setInterval(() => {
        void this.enqueue(name, {} as JobPayloads[typeof name], {
          dedupKey: `scheduled:${name}`,
        });
      }, everyMs);
      // don't keep the process alive just for the scheduler
      timer.unref?.();
      timers.push(timer);
    },
  };
}
