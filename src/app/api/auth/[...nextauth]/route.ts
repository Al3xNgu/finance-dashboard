import { NextResponse, type NextRequest } from "next/server";
import { handlers } from "@/server/auth";
import { createRateLimiter } from "@/server/lib/rate-limit";
import { log } from "@/server/lib/request-context";

export const { GET } = handlers;

/**
 * Magic-link abuse control (M8, D-021): the sign-in POST triggers an outbound
 * email, so it is rate-limited per client IP and per requested address. All
 * other Auth.js POSTs (callbacks, signout) pass through untouched.
 */
const byIp = createRateLimiter({ limit: 5, windowMs: 15 * 60_000 });
const byEmail = createRateLimiter({ limit: 3, windowMs: 15 * 60_000 });

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: NextRequest): Promise<Response> {
  if (req.nextUrl.pathname.startsWith("/api/auth/signin")) {
    const ip = clientIp(req);
    let email = "";
    try {
      email = String((await req.clone().formData()).get("email") ?? "")
        .trim()
        .toLowerCase();
    } catch {
      // not form-encoded; fall through with IP-only limiting
    }
    const allowed = byIp.check(`ip:${ip}`) && (!email || byEmail.check(`email:${email}`));
    if (!allowed) {
      log().warn({ ip }, "sign-in rate limit hit"); // never log the email
      return NextResponse.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Too many sign-in attempts. Try again in a few minutes.",
          },
        },
        { status: 429, headers: { "Retry-After": "900" } },
      );
    }
  }
  return handlers.POST(req);
}
