import { describe, expect, it, vi } from "vitest";
import { withRetry } from "@/server/lib/retry";

/** Fake sleep that records requested delays and resolves immediately. */
function fakeSleep() {
  const delays: number[] = [];
  const sleep = (ms: number): Promise<void> => {
    delays.push(ms);
    return Promise.resolve();
  };
  return { delays, sleep };
}

/** Rejects `failures` times, then resolves with `value`. */
function flaky<T>(failures: number, value: T) {
  let calls = 0;
  const fn = vi.fn(async () => {
    calls++;
    if (calls <= failures) {
      throw new Error(`failure ${calls}`);
    }
    return value;
  });
  return fn;
}

describe("withRetry", () => {
  it("returns immediately on first-try success without sleeping", async () => {
    const { delays, sleep } = fakeSleep();
    const fn = flaky(0, "ok");
    await expect(withRetry(fn, { sleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it("retries then succeeds, with full-jitter delays per attempt", async () => {
    const { delays, sleep } = fakeSleep();
    const base = 1000;
    const fn = flaky(3, "ok");
    await expect(
      withRetry(fn, { baseDelayMs: base, sleep }),
    ).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(4);
    expect(delays).toHaveLength(3);
    // delay(attempt) ∈ [0, base * 2^(attempt-1)]
    delays.forEach((delay, i) => {
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(base * 2 ** i);
    });
  });

  it("exhausts maxAttempts and rethrows the last error", async () => {
    const { delays, sleep } = fakeSleep();
    const fn = flaky(Infinity, "never");
    await expect(
      withRetry(fn, { maxAttempts: 3, sleep }),
    ).rejects.toThrow("failure 3");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(delays).toHaveLength(2); // no sleep after the final attempt
  });

  it("short-circuits when shouldRetry returns false", async () => {
    const { delays, sleep } = fakeSleep();
    const fn = flaky(Infinity, "never");
    const shouldRetry = vi.fn(() => false);
    await expect(
      withRetry(fn, { sleep, shouldRetry }),
    ).rejects.toThrow("failure 1");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
    expect(shouldRetry).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledWith(expect.any(Error), 1);
  });

  it("passes err and attempt to shouldRetry until it declines", async () => {
    const { sleep } = fakeSleep();
    const fn = flaky(Infinity, "never");
    const shouldRetry = vi.fn((_err: unknown, attempt: number) => attempt < 2);
    await expect(
      withRetry(fn, { maxAttempts: 10, sleep, shouldRetry }),
    ).rejects.toThrow("failure 2");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("never exceeds maxDelayMs even as the exponential window grows", async () => {
    const { delays, sleep } = fakeSleep();
    const fn = flaky(Infinity, "never");
    await expect(
      withRetry(fn, {
        maxAttempts: 8,
        baseDelayMs: 1000,
        maxDelayMs: 2500,
        sleep,
      }),
    ).rejects.toThrow("failure 8");
    expect(delays).toHaveLength(7);
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(2500);
    }
  });

  it("invokes onRetry with the error, attempt, and chosen delay", async () => {
    const { delays, sleep } = fakeSleep();
    const fn = flaky(2, "ok");
    const onRetry = vi.fn();
    await expect(withRetry(fn, { sleep, onRetry })).resolves.toBe("ok");
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, expect.any(Error), 1, delays[0]);
    expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(Error), 2, delays[1]);
  });

  it("does not call onRetry on the final failing attempt", async () => {
    const { sleep } = fakeSleep();
    const fn = flaky(Infinity, "never");
    const onRetry = vi.fn();
    await expect(
      withRetry(fn, { maxAttempts: 2, sleep, onRetry }),
    ).rejects.toThrow("failure 2");
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("rethrows non-Error values as-is", async () => {
    const { sleep } = fakeSleep();
    const fn = vi.fn(async () => {
      throw "string-failure";
    });
    await expect(
      withRetry(fn, { maxAttempts: 2, sleep }),
    ).rejects.toBe("string-failure");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
