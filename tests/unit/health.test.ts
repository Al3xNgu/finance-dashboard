import { beforeEach, describe, expect, it, vi } from "vitest";

const { pingDatabase } = vi.hoisted(() => ({
  pingDatabase: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("@/server/db/client", () => ({ pingDatabase }));

import { GET } from "@/app/api/v1/health/route";

describe("GET /api/v1/health", () => {
  beforeEach(() => pingDatabase.mockReset());

  it("returns 200 ok when the database is reachable", async () => {
    pingDatabase.mockResolvedValue(true);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "up" });
  });

  it("returns 503 degraded when the database is down", async () => {
    pingDatabase.mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded", db: "down" });
  });
});
