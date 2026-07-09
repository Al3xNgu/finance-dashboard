import "server-only";
import NextAuth, { type DefaultSession } from "next-auth";
import type { Adapter } from "@auth/core/adapters";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import type { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/server/db/client";
import { AuthenticationError } from "@/server/lib/errors";
import { env } from "@/server/lib/env";
import { logger } from "@/server/lib/logger";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

// The adapter only touches these four delegates. `account` is mapped to our
// renamed AuthAccount model (D-004: the domain owns the name "Account").
const adapter: Adapter = PrismaAdapter({
  user: db.user,
  account: db.authAccount,
  session: db.session,
  verificationToken: db.verificationToken,
} as unknown as PrismaClient);

const hasGoogle = !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET;
const hasSmtp = !!env.EMAIL_SERVER && !!env.EMAIL_FROM;

const providers = [
  // Magic-link email. In development without SMTP the link is logged to the
  // server console instead of sent — the only place a sign-in URL may ever
  // be logged. env.ts guarantees production has a real provider.
  Nodemailer({
    server: env.EMAIL_SERVER ?? "smtp://localhost:1025",
    from: env.EMAIL_FROM ?? "dev@localhost",
    ...(hasSmtp
      ? {}
      : {
          sendVerificationRequest: async ({ identifier, url }) => {
            logger.info(`Magic link for ${identifier}: ${url}`);
          },
        }),
  }),
  ...(hasGoogle
    ? [
        Google({
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        }),
      ]
    : []),
];

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  providers,
  secret: env.AUTH_SECRET,
  session: { strategy: "database" },
  pages: {
    signIn: "/signin",
    verifyRequest: "/verify-request",
  },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});

export interface CurrentUser {
  id: string;
  email: string;
}

/**
 * The authorization boundary for every API handler and service entry point.
 * Middleware redirects are UX only (ARCHITECTURE.md §5).
 */
export async function requireUser(): Promise<CurrentUser> {
  const session = await auth();
  if (!session?.user?.id) throw new AuthenticationError();
  return { id: session.user.id, email: session.user.email ?? "" };
}
