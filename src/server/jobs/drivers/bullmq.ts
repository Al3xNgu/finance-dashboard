import "server-only";
import { Queue, Worker, type Job } from "bullmq";
import { logger } from "@/server/lib/logger";
import type {
  EnqueueOptions,
  HandlerRegistry,
  JobName,
  JobPayloads,
  JobQueue,
} from "../queue";

/**
 * Production driver (M8, D-020). One BullMQ Queue + one Worker on a single
 * queue name. Dedup uses a deterministic jobId derived from dedupKey: BullMQ
 * ignores `add()` calls whose jobId already has a live job hash in Redis, so
 * two enqueues with the same dedupKey collapse into one while the job is
 * waiting/active — matching the in-process driver's semantics (dedup only
 * while pending/running). `removeOnComplete`/`removeOnFail` delete that hash
 * as soon as the job finishes (success or failure), so a later enqueue with
 * the same dedupKey always starts a fresh job instead of being swallowed.
 */
const QUEUE_NAME = "jobs";

export function createBullMqQueue(
  handlers: HandlerRegistry,
  redisUrl: string,
  role: "all" | "producer" | "worker" = "all",
): JobQueue {
  const queue = new Queue<JobPayloads[JobName], void, JobName>(QUEUE_NAME, {
    connection: { url: redisUrl },
  });

  async function dispatch<N extends JobName>(
    name: N,
    payload: JobPayloads[N],
  ): Promise<void> {
    const handler = handlers[name];
    if (!handler) {
      throw new Error(`no handler registered for job "${name}"`);
    }
    await handler(payload);
  }

  // "producer" replicas never run a Worker: in a horizontally scaled
  // deployment exactly one "worker"/"all" instance executes jobs, so
  // concurrency: 1 actually means one sync at a time (M8 security review).
  let worker: Worker<JobPayloads[JobName], void, JobName> | null = null;
  if (role !== "producer") {
    worker = new Worker<JobPayloads[JobName], void, JobName>(
      QUEUE_NAME,
      async (job: Job<JobPayloads[JobName], void, JobName>) => {
        await dispatch(job.name, job.data);
      },
      {
        connection: { url: redisUrl },
        // single-user app: avoid concurrent syncs of the same item racing
        concurrency: 1,
      },
    );

    worker.on("active", (job) => {
      logger.child({ jobId: job.id, job: job.name }).info("job started");
    });
    worker.on("completed", (job) => {
      logger.child({ jobId: job.id, job: job.name }).info("job finished");
    });
    worker.on("failed", (job, err) => {
      logger
        .child({ jobId: job?.id, job: job?.name })
        .error({ err }, "job failed");
    });
    worker.on("error", (err) => {
      logger.error({ err }, "bullmq worker error");
    });
  }

  // Note: `jobQueue` intentionally carries one extra method (`close`) beyond
  // the `JobQueue` interface, for graceful shutdown / test teardown. It's
  // assigned to a variable (not returned as a literal) so the extra property
  // isn't excess-property-checked away by the `JobQueue` return type below.
  const jobQueue = {
    async enqueue<N extends JobName>(
      name: N,
      payload: JobPayloads[N],
      opts?: EnqueueOptions,
    ) {
      // namespaced by job name: jobIds are queue-global, so an identical
      // dedupKey on two different job names must not collapse them
      const jobId = opts?.dedupKey ? `dedup:${name}:${opts.dedupKey}` : undefined;
      await queue.add(name, payload, {
        jobId,
        // finished jobs must not block a later enqueue with the same
        // deterministic jobId — remove the job hash as soon as it settles.
        removeOnComplete: true,
        removeOnFail: true,
      });
    },

    schedule(name: JobName, everyMs: number): void {
      // jobSchedulerId = name gives one stable scheduler per job name,
      // stable across process restarts.
      queue
        .upsertJobScheduler(
          name,
          { every: everyMs },
          { name, data: {} as JobPayloads[typeof name] },
        )
        .catch((err: unknown) => {
          logger.error({ err, job: name }, "failed to schedule repeatable job");
        });
    },

    /** Graceful shutdown: not part of `JobQueue`, used by tests/process exit. */
    async close(): Promise<void> {
      if (worker) await worker.close();
      await queue.close();
    },
  };

  return jobQueue;
}
