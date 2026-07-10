import "server-only";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppError, InternalError, ValidationError } from "./errors";
import { log, runWithRequestContext } from "./request-context";

/**
 * Wraps every /api/v1 route handler: request id, logging, and the single
 * error envelope (ARCHITECTURE.md §8). Nothing but this envelope can escape
 * to the client on failure.
 */
type RouteContext = { params: Promise<Record<string, string | string[]>> };
type Handler = (req: NextRequest, ctx: RouteContext) => Promise<NextResponse>;

export function apiHandler(handler: Handler): Handler {
  return async (req, ctx) => {
    const requestId = `req_${randomUUID()}`;
    return runWithRequestContext(requestId, async () => {
      try {
        const res = await handler(req, ctx);
        res.headers.set("x-request-id", requestId);
        return res;
      } catch (err) {
        const appError =
          err instanceof AppError ? err : new InternalError({ cause: err });
        if (appError.httpStatus >= 500) {
          log().error(
            { err: appError, cause: appError.cause, path: req.nextUrl.pathname },
            "request failed",
          );
        } else {
          log().warn(
            { code: appError.code, path: req.nextUrl.pathname },
            "request rejected",
          );
        }
        return NextResponse.json(
          {
            error: {
              code: appError.code,
              message: appError.publicMessage,
              requestId,
              ...(appError.details !== undefined
                ? { details: appError.details }
                : {}),
            },
          },
          { status: appError.httpStatus, headers: { "x-request-id": requestId } },
        );
      }
    });
  };
}

/** Parse and validate a JSON body at the API boundary. */
export async function parseBody<S extends z.ZodType>(
  req: NextRequest,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError("Invalid request body.", {
      details: result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }
  return result.data;
}

/**
 * Like parseBody, but an empty body is valid and parses as {} — for endpoints
 * whose body is entirely optional (e.g. link-token's update-mode itemId).
 */
export async function parseOptionalBody<S extends z.ZodType>(
  req: NextRequest,
  schema: S,
): Promise<z.infer<S>> {
  const raw = await req.text();
  let parsed: unknown = {};
  if (raw.trim() !== "") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ValidationError("Request body must be valid JSON.");
    }
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationError("Invalid request body.", {
      details: result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }
  return result.data;
}

/** Parse and validate query params at the API boundary. */
export function parseQuery<S extends z.ZodType>(
  req: NextRequest,
  schema: S,
): z.infer<S> {
  const raw = Object.fromEntries(req.nextUrl.searchParams);
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError("Invalid query parameters.", {
      details: result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }
  return result.data;
}
