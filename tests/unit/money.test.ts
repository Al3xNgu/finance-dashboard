import { describe, expect, it } from "vitest";
import {
  centsToNumber,
  dollarsToCents,
  nullableDollarsToCents,
} from "@/server/lib/money";

describe("money conversions", () => {
  it("converts Plaid dollar floats to bigint cents exactly", () => {
    expect(dollarsToCents(12.34)).toBe(1234n);
    expect(dollarsToCents(0.1)).toBe(10n);
    expect(dollarsToCents(1078.5)).toBe(107850n);
    // classic float trap: 19.99 * 100 === 1998.9999999999998
    expect(dollarsToCents(19.99)).toBe(1999n);
    expect(dollarsToCents(-42.42)).toBe(-4242n);
    expect(dollarsToCents(0)).toBe(0n);
  });

  it("handles null/undefined balances", () => {
    expect(nullableDollarsToCents(null)).toBeNull();
    expect(nullableDollarsToCents(undefined)).toBeNull();
    expect(nullableDollarsToCents(5)).toBe(500n);
  });

  it("serializes bigint cents to safe JS numbers", () => {
    expect(centsToNumber(1234n)).toBe(1234);
    expect(centsToNumber(null)).toBeNull();
    expect(() => centsToNumber(2n ** 60n)).toThrow(/safe integer/);
  });
});
