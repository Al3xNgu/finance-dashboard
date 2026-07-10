import { describe, expect, it } from "vitest";
import {
  resolveCategoryId,
  type CategorizationContext,
  type TxnForCategorization,
} from "@/server/services/categorization";

function makeCtx(over: Partial<CategorizationContext> = {}): CategorizationContext {
  return {
    rules: [],
    categoryIdBySlug: new Map([
      ["coffee", "cat-coffee"],
      ["food-and-dining", "cat-food"],
      ["uncategorized", "cat-unc"],
    ]),
    mappingSlugByDetailed: new Map([
      ["FOOD_AND_DRINK_COFFEE", "coffee"],
      ["FOOD_AND_DRINK", "food-and-dining"],
    ]),
    ...over,
  };
}

function makeTxn(over: Partial<TxnForCategorization> = {}): TxnForCategorization {
  return {
    merchantName: "Starbucks",
    name: "STARBUCKS #1234",
    amountCents: 500n,
    accountId: "acct-1",
    pfcPrimary: "FOOD_AND_DRINK",
    pfcDetailed: "FOOD_AND_DRINK_COFFEE",
    ...over,
  };
}

const rule = (over: Partial<CategorizationContext["rules"][number]> = {}) => ({
  categoryId: "cat-rule",
  matchField: "MERCHANT_NAME" as const,
  matchType: "CONTAINS" as const,
  matchValue: "starbucks",
  minAmountCents: null,
  maxAmountCents: null,
  accountId: null,
  ...over,
});

describe("resolveCategoryId — resolution order", () => {
  it("rules beat the plaid mapping", () => {
    expect(resolveCategoryId(makeTxn(), makeCtx({ rules: [rule()] }))).toBe("cat-rule");
  });

  it("mapping applies when no rule matches: detailed beats primary", () => {
    expect(resolveCategoryId(makeTxn(), makeCtx())).toBe("cat-coffee");
  });

  it("falls back to the primary-level mapping row", () => {
    const txn = makeTxn({ pfcDetailed: "FOOD_AND_DRINK_SOMETHING_NEW" });
    expect(resolveCategoryId(txn, makeCtx())).toBe("cat-food");
  });

  it("falls back to uncategorized when nothing maps", () => {
    const txn = makeTxn({ pfcPrimary: "UNKNOWN", pfcDetailed: null });
    expect(resolveCategoryId(txn, makeCtx())).toBe("cat-unc");
  });

  it("returns null when even uncategorized is absent (pre-seed)", () => {
    const ctx = makeCtx({ categoryIdBySlug: new Map() });
    const txn = makeTxn({ pfcPrimary: null, pfcDetailed: null });
    expect(resolveCategoryId(txn, ctx)).toBeNull();
  });

  it("mapping to a missing slug degrades to uncategorized", () => {
    const ctx = makeCtx({
      mappingSlugByDetailed: new Map([["FOOD_AND_DRINK_COFFEE", "ghost-slug"]]),
    });
    expect(resolveCategoryId(makeTxn(), ctx)).toBe("cat-unc");
  });
});

describe("resolveCategoryId — rule matching", () => {
  it("first matching rule by order wins", () => {
    const ctx = makeCtx({
      rules: [
        rule({ categoryId: "cat-first", matchValue: "star" }),
        rule({ categoryId: "cat-second", matchValue: "starbucks" }),
      ],
    });
    expect(resolveCategoryId(makeTxn(), ctx)).toBe("cat-first");
  });

  it("matches case-insensitively across CONTAINS / EQUALS / STARTS_WITH", () => {
    const eq = rule({ matchType: "EQUALS", matchValue: "STARBUCKS" });
    const sw = rule({ matchType: "STARTS_WITH", matchValue: "star" });
    expect(resolveCategoryId(makeTxn(), makeCtx({ rules: [eq] }))).toBe("cat-rule");
    expect(resolveCategoryId(makeTxn(), makeCtx({ rules: [sw] }))).toBe("cat-rule");
    const noMatch = rule({ matchType: "EQUALS", matchValue: "starbucks #1" });
    expect(resolveCategoryId(makeTxn(), makeCtx({ rules: [noMatch] }))).toBe("cat-coffee");
  });

  it("DESCRIPTION field matches the raw name; null merchant never matches MERCHANT_NAME", () => {
    const txn = makeTxn({ merchantName: null });
    const merchantRule = rule();
    const descRule = rule({ matchField: "DESCRIPTION", matchValue: "#1234" });
    expect(resolveCategoryId(txn, makeCtx({ rules: [merchantRule] }))).toBe("cat-coffee");
    expect(resolveCategoryId(txn, makeCtx({ rules: [descRule] }))).toBe("cat-rule");
  });

  it("amount range bounds are inclusive and filter correctly", () => {
    const bounded = rule({ minAmountCents: 400n, maxAmountCents: 600n });
    expect(resolveCategoryId(makeTxn({ amountCents: 500n }), makeCtx({ rules: [bounded] }))).toBe("cat-rule");
    expect(resolveCategoryId(makeTxn({ amountCents: 400n }), makeCtx({ rules: [bounded] }))).toBe("cat-rule");
    expect(resolveCategoryId(makeTxn({ amountCents: 399n }), makeCtx({ rules: [bounded] }))).toBe("cat-coffee");
    expect(resolveCategoryId(makeTxn({ amountCents: 601n }), makeCtx({ rules: [bounded] }))).toBe("cat-coffee");
  });

  it("account-scoped rules skip other accounts", () => {
    const scoped = rule({ accountId: "acct-other" });
    expect(resolveCategoryId(makeTxn(), makeCtx({ rules: [scoped] }))).toBe("cat-coffee");
    expect(
      resolveCategoryId(makeTxn({ accountId: "acct-other" }), makeCtx({ rules: [scoped] })),
    ).toBe("cat-rule");
  });

  it("blank patterns never match anything", () => {
    const blank = rule({ matchValue: "   " });
    expect(resolveCategoryId(makeTxn(), makeCtx({ rules: [blank] }))).toBe("cat-coffee");
  });
});
