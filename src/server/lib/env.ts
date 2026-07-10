import "server-only";
import { z } from "zod";

/**
 * Environment contract. Variables for future milestones are declared optional
 * here and tightened to required in the milestone that starts using them, so
 * the app always fails fast on exactly what it currently needs.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .regex(/^postgres(ql)?:\/\//, "DATABASE_URL must be a postgres:// URL"),

  // M1 — auth
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must be at least 32 chars (openssl rand -base64 32)"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // SMTP for magic-link email. Optional in development (link is logged to the
  // server console instead); production requires this or a Google OAuth pair.
  EMAIL_SERVER: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  // M2 — Plaid. Environment switching is env-only by design (ARCHITECTURE.md §6.1).
  PLAID_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  PLAID_CLIENT_ID: z.string().optional(),
  PLAID_SECRET: z.string().optional(),
  PLAID_WEBHOOK_URL: z.string().optional(),
  ENCRYPTION_KEY: z
    .string()
    .refine(
      (v) => Buffer.from(v, "base64").length === 32,
      "ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)",
    )
    .optional(),

  // M3 — background jobs
  QUEUE_DRIVER: z.enum(["inprocess", "bullmq"]).default("inprocess"),
  REDIS_URL: z.string().optional(),
  // bullmq only: "producer" replicas enqueue but never run a Worker, so one
  // "worker"/"all" instance owns job execution (M8 security review)
  QUEUE_ROLE: z.enum(["all", "producer", "worker"]).default("all"),
}).superRefine((cfg, ctx) => {
  const hasGoogle = !!cfg.GOOGLE_CLIENT_ID && !!cfg.GOOGLE_CLIENT_SECRET;
  const hasEmail = !!cfg.EMAIL_SERVER && !!cfg.EMAIL_FROM;
  if (cfg.NODE_ENV === "production" && !hasGoogle && !hasEmail) {
    ctx.addIssue({
      code: "custom",
      path: ["EMAIL_SERVER"],
      message:
        "production needs a sign-in provider: EMAIL_SERVER+EMAIL_FROM or GOOGLE_CLIENT_ID+GOOGLE_CLIENT_SECRET",
    });
  }
  if (cfg.QUEUE_DRIVER === "bullmq" && !cfg.REDIS_URL) {
    ctx.addIssue({
      code: "custom",
      path: ["REDIS_URL"],
      message: "REDIS_URL is required when QUEUE_DRIVER=bullmq (D-020)",
    });
  }
  const plaidVars = [cfg.PLAID_CLIENT_ID, cfg.PLAID_SECRET];
  if (plaidVars.some(Boolean)) {
    if (!plaidVars.every(Boolean)) {
      ctx.addIssue({
        code: "custom",
        path: ["PLAID_CLIENT_ID"],
        message: "PLAID_CLIENT_ID and PLAID_SECRET must be set together",
      });
    }
    if (!cfg.ENCRYPTION_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["ENCRYPTION_KEY"],
        message:
          "ENCRYPTION_KEY is required when Plaid is configured (access tokens are encrypted at rest)",
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

export const env: Env = parseEnv(process.env);
