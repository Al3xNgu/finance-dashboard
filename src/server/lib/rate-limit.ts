import "server-only";

/**
 * Sliding-window rate limiter, in-memory and per-instance (D-021). State is
 * process-local: restarts reset the window, which can only weaken limiting,
 * never block legitimate use. Multi-instance deployments need a shared store.
 *
 * Hardening (M8 security review):
 * - the full-map sweep is time-gated (once per window) so an attacker
 *   flooding unique keys can't force O(n) work on every request;
 * - the map is capped; at the cap, NEW keys fail closed — under a
 *   key-flooding attack, protecting the outbound-email budget beats
 *   availability for never-seen clients.
 */
export interface RateLimiter {
  /** true = allowed (and counted); false = over the limit */
  check(key: string): boolean;
}

export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  /** max tracked keys before new keys fail closed (default 10k) */
  maxKeys?: number;
  /** injectable clock for tests */
  now?: () => number;
}): RateLimiter {
  const { limit, windowMs, maxKeys = 10_000, now = Date.now } = opts;
  const hits = new Map<string, number[]>();
  let lastSweep = 0;

  return {
    check(key: string): boolean {
      const t = now();
      const cutoff = t - windowMs;

      if (t - lastSweep >= windowMs) {
        lastSweep = t;
        for (const [k, stamps] of hits) {
          const live = stamps.filter((s) => s > cutoff);
          if (live.length === 0) hits.delete(k);
          else hits.set(k, live);
        }
      }

      const current = (hits.get(key) ?? []).filter((s) => s > cutoff);
      if (current.length >= limit) {
        hits.set(key, current);
        return false;
      }
      if (!hits.has(key) && hits.size >= maxKeys) {
        return false; // fail closed for new keys at capacity
      }
      current.push(t);
      hits.set(key, current);
      return true;
    },
  };
}
