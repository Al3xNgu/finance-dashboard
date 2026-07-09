import { NextRequest, NextResponse } from "next/server";

/**
 * Optimistic page protection only: redirects unauthenticated page loads to
 * /signin based on session-cookie presence. This is UX, not security — the
 * edge runtime cannot validate database sessions. The real boundary is
 * requireUser() in every API handler and server component (ARCHITECTURE.md §5).
 */
export default function proxy(req: NextRequest) {
  const hasSessionCookie =
    req.cookies.has("authjs.session-token") ||
    req.cookies.has("__Secure-authjs.session-token");

  if (!hasSessionCookie) {
    const signInUrl = new URL("/signin", req.url);
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }
  return NextResponse.next();
}

export const config = {
  // Pages only. /api routes enforce auth themselves via requireUser();
  // /api/auth and the Plaid webhook must stay reachable without a session.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|signin|verify-request|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)).*)",
  ],
};
