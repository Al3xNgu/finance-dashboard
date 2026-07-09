import { describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, parseBody, parseQuery } from "@/server/lib/api-handler";
import {
  AuthenticationError,
  NotFoundError,
  ValidationError,
} from "@/server/lib/errors";

const ctx = { params: Promise.resolve({}) };

function makeReq(
  url = "http://test.local/api/v1/x",
  init?: ConstructorParameters<typeof NextRequest>[1],
) {
  return new NextRequest(url, init);
}

describe("apiHandler", () => {
  it("passes through successful responses and attaches a request id", async () => {
    const handler = apiHandler(async () => NextResponse.json({ data: 1 }));
    const res = await handler(makeReq(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toMatch(/^req_/);
  });

  it("maps AppError subclasses to their envelope and status", async () => {
    const handler = apiHandler(async () => {
      throw new AuthenticationError();
    });
    const res = await handler(makeReq(), ctx);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(body.error.requestId).toMatch(/^req_/);
  });

  it("maps NotFoundError to 404", async () => {
    const handler = apiHandler(async () => {
      throw new NotFoundError();
    });
    const res = await handler(makeReq(), ctx);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("never leaks unknown errors — generic 500 envelope only", async () => {
    const handler = apiHandler(async () => {
      throw new Error("secret internal detail: db password xyz");
    });
    const res = await handler(makeReq(), ctx);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("xyz");
  });

  it("includes ValidationError field details in the envelope", async () => {
    const handler = apiHandler(async (req) => {
      await parseBody(req, z.object({ email: z.string().email() }));
      return NextResponse.json({});
    });
    const res = await handler(
      makeReq(undefined, {
        method: "POST",
        body: JSON.stringify({ email: "nope" }),
        headers: { "content-type": "application/json" },
      }),
      ctx,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[0].path).toBe("email");
  });
});

describe("parseBody / parseQuery", () => {
  it("rejects non-JSON bodies", async () => {
    await expect(
      parseBody(
        makeReq(undefined, { method: "POST", body: "not-json" }),
        z.object({}),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("parses valid query params", () => {
    const req = makeReq("http://test.local/api/v1/x?limit=10");
    const parsed = parseQuery(req, z.object({ limit: z.coerce.number() }));
    expect(parsed.limit).toBe(10);
  });

  it("rejects invalid query params", () => {
    const req = makeReq("http://test.local/api/v1/x?limit=abc");
    expect(() =>
      parseQuery(req, z.object({ limit: z.coerce.number() })),
    ).toThrow(ValidationError);
  });
});
