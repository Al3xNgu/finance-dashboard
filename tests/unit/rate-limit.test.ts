import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/server/lib/rate-limit";

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createRateLimiter", () => {
  it("allows up to the limit within a window, then blocks", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 3, windowMs: 1000, now: c.now });
    expect(rl.check("k")).toBe(true);
    expect(rl.check("k")).toBe(true);
    expect(rl.check("k")).toBe(true);
    expect(rl.check("k")).toBe(false);
  });

  it("slides: old hits expire and free capacity", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 2, windowMs: 1000, now: c.now });
    expect(rl.check("k")).toBe(true);
    c.advance(600);
    expect(rl.check("k")).toBe(true);
    expect(rl.check("k")).toBe(false);
    c.advance(500); // first hit (t=0) now outside the window
    expect(rl.check("k")).toBe(true);
    expect(rl.check("k")).toBe(false);
  });

  it("keys are independent", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    expect(rl.check("a")).toBe(true);
    expect(rl.check("b")).toBe(true);
    expect(rl.check("a")).toBe(false);
  });

  it("blocked attempts are not counted against the window", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    expect(rl.check("k")).toBe(true);
    for (let i = 0; i < 10; i++) {
      expect(rl.check("k")).toBe(false);
      c.advance(50);
    }
    c.advance(600); // t=1100 > windowMs after the single counted hit
    expect(rl.check("k")).toBe(true);
  });

  it("fails closed for new keys once the key cap is reached", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 2, windowMs: 1000, maxKeys: 3, now: c.now });
    expect(rl.check("a")).toBe(true);
    expect(rl.check("b")).toBe(true);
    expect(rl.check("c")).toBe(true);
    expect(rl.check("d")).toBe(false); // new key at capacity → blocked
    expect(rl.check("a")).toBe(true); // existing keys keep working
    c.advance(1100); // window passes; sweep frees capacity
    expect(rl.check("d")).toBe(true);
  });

  it("prunes expired keys from memory", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 1, windowMs: 100, now: c.now });
    for (let i = 0; i < 50; i++) rl.check(`k${i}`);
    c.advance(200);
    // all previous keys expired; a fresh check triggers the prune and succeeds
    expect(rl.check("fresh")).toBe(true);
    expect(rl.check("k0")).toBe(true); // fully reset, not blocked
  });
});
