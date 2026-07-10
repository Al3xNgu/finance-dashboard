import "server-only";

/**
 * Job abstraction (ARCHITECTURE.md §11). Handlers must be idempotent —
 * sync correctness never depends on exactly-once delivery (D-013).
 * Drivers: in-process (dev, zero infra). The production driver (BullMQ or
 * platform queue) lands with production config in M8 behind this interface.
 */
export interface JobPayloads {
  "sync-item": {
    /** database id of the PlaidItem */
    itemId: string;
    trigger: "INITIAL" | "WEBHOOK" | "SCHEDULED" | "MANUAL";
  };
  "poll-stale-items": Record<string, never>;
}

export type JobName = keyof JobPayloads;

export interface EnqueueOptions {
  /** jobs sharing a dedupKey are collapsed while one is pending/running */
  dedupKey?: string;
}

export interface JobQueue {
  enqueue<N extends JobName>(
    name: N,
    payload: JobPayloads[N],
    opts?: EnqueueOptions,
  ): Promise<void>;
  /** register a repeating job (dev: setInterval; prod driver: cron) */
  schedule(name: JobName, everyMs: number): void;
}

export type JobHandler<N extends JobName> = (
  payload: JobPayloads[N],
) => Promise<void>;

export type HandlerRegistry = {
  [N in JobName]: JobHandler<N>;
};
