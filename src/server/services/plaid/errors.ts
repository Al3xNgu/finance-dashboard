import "server-only";
import { UpstreamError } from "@/server/lib/errors";

/**
 * Plaid error classification. Every Plaid `error_code` maps to one of three
 * classes that drive the caller's recovery strategy:
 * - RETRYABLE — transient; retry with backoff, then mark the item ERROR.
 * - REAUTH    — the user must re-link via update-mode Link.
 * - FATAL     — the item/token is unusable; do not retry.
 */
export type PlaidErrorClass = "RETRYABLE" | "REAUTH" | "FATAL";

/** Fallback code when a thrown value has no recognizable Plaid error shape. */
const UNKNOWN_PLAID_CODE = "PLAID_ERROR";

const CLASSIFICATION: Record<string, PlaidErrorClass> = {
  // User action required: relink through update-mode Link.
  ITEM_LOGIN_REQUIRED: "REAUTH",
  PENDING_EXPIRATION: "REAUTH",
  PENDING_DISCONNECT: "REAUTH",
  INVALID_CREDENTIALS: "REAUTH",
  INVALID_MFA: "REAUTH",
  ITEM_LOCKED: "REAUTH",
  USER_SETUP_REQUIRED: "REAUTH",
  MFA_NOT_SUPPORTED: "REAUTH",
  INSUFFICIENT_CREDENTIALS: "REAUTH",

  // Unrecoverable: the item or token is gone/revoked/misconfigured.
  ITEM_NOT_FOUND: "FATAL",
  ACCESS_NOT_GRANTED: "FATAL",
  USER_PERMISSION_REVOKED: "FATAL",
  INVALID_ACCESS_TOKEN: "FATAL",
  INVALID_API_KEYS: "FATAL",
  UNAUTHORIZED_ENVIRONMENT: "FATAL",
  ITEM_NO_ERROR: "FATAL",
  INSTITUTION_NO_LONGER_SUPPORTED: "FATAL",

  // Transient: retry with backoff.
  RATE_LIMIT_EXCEEDED: "RETRYABLE",
  TRANSACTIONS_LIMIT: "RETRYABLE",
  INTERNAL_SERVER_ERROR: "RETRYABLE",
  PLANNED_MAINTENANCE: "RETRYABLE",
  INSTITUTION_DOWN: "RETRYABLE",
  INSTITUTION_NOT_RESPONDING: "RETRYABLE",
  // The sync loop restarts from the last committed cursor.
  TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION: "RETRYABLE",
  [UNKNOWN_PLAID_CODE]: "RETRYABLE",
};

/**
 * Classify a Plaid `error_code` string. Unknown codes are RETRYABLE: bounded
 * retries then the caller marks the item ERROR — never silently drops data.
 */
export function classifyPlaidError(errorCode: string): PlaidErrorClass {
  return CLASSIFICATION[errorCode] ?? "RETRYABLE";
}

export class PlaidApiError extends UpstreamError {
  constructor(
    public readonly plaidErrorCode: string,
    public readonly classification: PlaidErrorClass,
    opts?: { cause?: unknown },
  ) {
    // Only the code reaches the client; the raw upstream body stays on `cause`.
    super(`Bank connection service failed (${plaidErrorCode}).`, opts);
  }
}

/**
 * Build a PlaidApiError from an unknown thrown value. Recognizes axios-style
 * errors carrying `response.data.error_code`; anything else falls back to the
 * code "PLAID_ERROR" (RETRYABLE). The original value is preserved as `cause`.
 */
export function toPlaidApiError(err: unknown): PlaidApiError {
  if (err instanceof PlaidApiError) {
    return err;
  }
  const code = extractPlaidErrorCode(err) ?? UNKNOWN_PLAID_CODE;
  return new PlaidApiError(code, classifyPlaidError(code), { cause: err });
}

function extractPlaidErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) {
    return undefined;
  }
  const response = (err as { response?: unknown }).response;
  if (typeof response !== "object" || response === null) {
    return undefined;
  }
  const data = (response as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  const code = (data as { error_code?: unknown }).error_code;
  return typeof code === "string" && code.length > 0 ? code : undefined;
}
