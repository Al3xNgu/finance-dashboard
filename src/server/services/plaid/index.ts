import "server-only";
import { env } from "@/server/lib/env";
import { createPlaidSdkService } from "./sdk";
import type { PlaidService } from "./types";

let instance: PlaidService | undefined;

/** Lazily constructed singleton; env validity is guaranteed by env.ts. */
export function getPlaidService(): PlaidService {
  if (!instance) {
    if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
      throw new Error(
        "Plaid is not configured: set PLAID_CLIENT_ID and PLAID_SECRET",
      );
    }
    instance = createPlaidSdkService({
      clientId: env.PLAID_CLIENT_ID,
      secret: env.PLAID_SECRET,
      environment: env.PLAID_ENV,
      webhookUrl: env.PLAID_WEBHOOK_URL,
    });
  }
  return instance;
}

export type { PlaidService } from "./types";
