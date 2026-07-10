"use client";

import { useEffect } from "react";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";

/**
 * Pulls a human-readable message out of the API error envelope
 * ({"error":{"code","message","requestId"}}) without ever touching tokens.
 */
export async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error?: { message?: unknown } }).error?.message === "string"
    ) {
      return (body as { error: { message: string } }).error.message;
    }
  } catch {
    // fall through to the generic message
  }
  return fallback;
}

/**
 * usePlaidLink requires a non-null token at initialization, so this child is
 * only mounted once a link token exists; it auto-opens Link when ready.
 */
export function PlaidLinkOpener({
  token,
  onSuccess,
  onExit,
}: {
  token: string;
  onSuccess: PlaidLinkOnSuccess;
  onExit: () => void;
}) {
  const { open, ready } = usePlaidLink({ token, onSuccess, onExit });

  useEffect(() => {
    if (ready) open();
  }, [ready, open]);

  return null;
}
