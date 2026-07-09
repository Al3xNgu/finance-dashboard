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
  AUTH_SECRET: z.string().min(32).optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

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
