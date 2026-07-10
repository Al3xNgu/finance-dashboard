import { describe, expect, it } from "vitest";
import { AppError, UpstreamError } from "@/server/lib/errors";
import {
  PlaidApiError,
  classifyPlaidError,
  toPlaidApiError,
} from "@/server/services/plaid/errors";

const REAUTH_CODES = [
  "ITEM_LOGIN_REQUIRED",
  "PENDING_EXPIRATION",
  "PENDING_DISCONNECT",
  "INVALID_CREDENTIALS",
  "INVALID_MFA",
  "ITEM_LOCKED",
  "USER_SETUP_REQUIRED",
  "MFA_NOT_SUPPORTED",
  "INSUFFICIENT_CREDENTIALS",
];

const FATAL_CODES = [
  "ITEM_NOT_FOUND",
  "ACCESS_NOT_GRANTED",
  "USER_PERMISSION_REVOKED",
  "INVALID_ACCESS_TOKEN",
  "INVALID_API_KEYS",
  "UNAUTHORIZED_ENVIRONMENT",
  "ITEM_NO_ERROR",
  "INSTITUTION_NO_LONGER_SUPPORTED",
];

const RETRYABLE_CODES = [
  "RATE_LIMIT_EXCEEDED",
  "TRANSACTIONS_LIMIT",
  "INTERNAL_SERVER_ERROR",
  "PLANNED_MAINTENANCE",
  "INSTITUTION_DOWN",
  "INSTITUTION_NOT_RESPONDING",
  "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
  "PLAID_ERROR",
];

describe("classifyPlaidError", () => {
  it.each(REAUTH_CODES)("classifies %s as REAUTH", (code) => {
    expect(classifyPlaidError(code)).toBe("REAUTH");
  });

  it.each(FATAL_CODES)("classifies %s as FATAL", (code) => {
    expect(classifyPlaidError(code)).toBe("FATAL");
  });

  it.each(RETRYABLE_CODES)("classifies %s as RETRYABLE", (code) => {
    expect(classifyPlaidError(code)).toBe("RETRYABLE");
  });

  it("classifies unknown codes as RETRYABLE", () => {
    expect(classifyPlaidError("SOME_FUTURE_CODE")).toBe("RETRYABLE");
    expect(classifyPlaidError("")).toBe("RETRYABLE");
  });
});

describe("PlaidApiError", () => {
  it("is an UpstreamError with httpStatus 502", () => {
    const err = new PlaidApiError("ITEM_NOT_FOUND", "FATAL");
    expect(err).toBeInstanceOf(PlaidApiError);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err).toBeInstanceOf(AppError);
    expect(err.httpStatus).toBe(502);
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(err.name).toBe("PlaidApiError");
  });

  it("exposes only the code in publicMessage", () => {
    const err = new PlaidApiError("RATE_LIMIT_EXCEEDED", "RETRYABLE");
    expect(err.publicMessage).toBe(
      "Bank connection service failed (RATE_LIMIT_EXCEEDED).",
    );
  });
});

describe("toPlaidApiError", () => {
  it("extracts code + classification from an axios-shaped error", () => {
    const upstream = {
      response: {
        data: {
          error_type: "ITEM_ERROR",
          error_code: "ITEM_LOGIN_REQUIRED",
          error_message: "the login details of this item have changed",
          request_id: "req-abc-123",
        },
      },
    };
    const err = toPlaidApiError(upstream);
    expect(err.plaidErrorCode).toBe("ITEM_LOGIN_REQUIRED");
    expect(err.classification).toBe("REAUTH");
    expect(err.cause).toBe(upstream);
    // The raw body never leaks into the client-safe message.
    expect(err.publicMessage).toBe(
      "Bank connection service failed (ITEM_LOGIN_REQUIRED).",
    );
    expect(err.publicMessage).not.toContain("login details");
    expect(err.publicMessage).not.toContain("req-abc-123");
  });

  it("classifies an axios-shaped error via the lookup table", () => {
    const err = toPlaidApiError({
      response: { data: { error_code: "INSTITUTION_DOWN" } },
    });
    expect(err.plaidErrorCode).toBe("INSTITUTION_DOWN");
    expect(err.classification).toBe("RETRYABLE");
  });

  it("falls back to PLAID_ERROR / RETRYABLE for a plain Error", () => {
    const cause = new Error("x");
    const err = toPlaidApiError(cause);
    expect(err.plaidErrorCode).toBe("PLAID_ERROR");
    expect(err.classification).toBe("RETRYABLE");
    expect(err.cause).toBe(cause);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "boom"],
    ["a response without data", { response: {} }],
    ["data without error_code", { response: { data: { error_type: "X" } } }],
    ["a non-string error_code", { response: { data: { error_code: 7 } } }],
    ["an empty error_code", { response: { data: { error_code: "" } } }],
  ])("falls back to PLAID_ERROR for %s", (_label, value) => {
    const err = toPlaidApiError(value);
    expect(err.plaidErrorCode).toBe("PLAID_ERROR");
    expect(err.classification).toBe("RETRYABLE");
  });

  it("returns an existing PlaidApiError unchanged", () => {
    const original = new PlaidApiError("INVALID_ACCESS_TOKEN", "FATAL");
    expect(toPlaidApiError(original)).toBe(original);
  });
});
