import "server-only";

export interface RetryOptions {
  /** Total attempts including the first call. Default 5. */
  maxAttempts?: number;
  /** Backoff base for the jitter window. Default 1000. */
  baseDelayMs?: number;
  /** Upper bound on any single delay. Default 60000. */
  maxDelayMs?: number;
  /** Return false to rethrow immediately. Default: always retry. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Injectable for tests; defaults to a real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Observability hook, called before each backoff sleep. */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn`, retrying failures with exponential backoff and FULL jitter:
 * delay = random(0, min(maxDelayMs, baseDelayMs * 2^(attempt-1))). Rethrows
 * the last error once attempts are exhausted or `shouldRetry` returns false.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  const {
    maxAttempts = 5,
    baseDelayMs = 1000,
    maxDelayMs = 60_000,
    shouldRetry = () => true,
    sleep = defaultSleep,
    onRetry,
  } = opts ?? {};

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !shouldRetry(err, attempt)) {
        throw err;
      }
      const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delayMs = Math.random() * cap;
      onRetry?.(err, attempt, delayMs);
      await sleep(delayMs);
    }
  }
  // Unreachable for maxAttempts >= 1; guards against maxAttempts <= 0.
  throw lastError ?? new Error("withRetry: no attempts were made");
}
