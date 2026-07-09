import "server-only";

/**
 * Money is integer minor units (cents) as bigint in the database. Plaid sends
 * dollars as floats; conversion happens exactly once, here, at ingestion.
 * DTOs serialize bigint cents to JS number (values ≪ 2^53 — D-005).
 */
export function dollarsToCents(dollars: number): bigint {
  return BigInt(Math.round(dollars * 100));
}

export function nullableDollarsToCents(dollars: number | null | undefined): bigint | null {
  return dollars == null ? null : dollarsToCents(dollars);
}

export function centsToNumber(cents: bigint | null): number | null {
  if (cents == null) return null;
  const n = Number(cents);
  if (!Number.isSafeInteger(n)) {
    throw new Error("Money value exceeds safe integer range");
  }
  return n;
}
