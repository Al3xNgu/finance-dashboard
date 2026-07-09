import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AuthenticationError } from "@/server/lib/errors";

const { requireUser, findUniqueOrThrow } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  findUniqueOrThrow: vi.fn(),
}));

vi.mock("@/server/auth", () => ({ requireUser }));
vi.mock("@/server/db/client", () => ({
  db: { user: { findUniqueOrThrow } },
}));

import { GET } from "@/app/api/v1/me/route";

const ctx = { params: Promise.resolve({}) };
const req = new NextRequest("http://test.local/api/v1/me");

describe("GET /api/v1/me", () => {
  it("returns the current user's profile", async () => {
    requireUser.mockResolvedValue({ id: "u1", email: "a@b.c" });
    findUniqueOrThrow.mockResolvedValue({
      id: "u1",
      email: "a@b.c",
      name: null,
      image: null,
    });
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe("u1");
    // authz: the query must be scoped to the session user's id
    expect(findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u1" } }),
    );
  });

  it("returns the 401 envelope when unauthenticated", async () => {
    requireUser.mockRejectedValue(new AuthenticationError());
    const res = await GET(req, ctx);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });
});
