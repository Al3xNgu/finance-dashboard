import "server-only";
import { db } from "@/server/db/client";
import { log } from "@/server/lib/request-context";
import type {
  CategoryRule,
  RuleMatchField,
  RuleMatchType,
} from "@/generated/prisma/client";

/**
 * Layered categorization (ARCHITECTURE.md §7). Resolution order, highest wins:
 *   1. manual override (handled by callers: rows with userCategoryOverride are
 *      never passed through this engine)
 *   2. user rules by ascending priority
 *   3. PlaidCategoryMapping — detailed code, then primary-level fallback
 *   4. system "uncategorized" (or null before seeding)
 */
export interface TxnForCategorization {
  merchantName: string | null;
  name: string;
  amountCents: bigint;
  accountId: string;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
}

export interface CategorizationContext {
  rules: Pick<
    CategoryRule,
    | "categoryId"
    | "matchField"
    | "matchType"
    | "matchValue"
    | "minAmountCents"
    | "maxAmountCents"
    | "accountId"
  >[];
  categoryIdBySlug: Map<string, string>;
  mappingSlugByDetailed: Map<string, string>;
}

/** One query batch per sync page / recategorization run. */
export async function loadCategorizationContext(
  userId: string,
): Promise<CategorizationContext> {
  const [rules, categories, mappings] = await Promise.all([
    db.categoryRule.findMany({
      where: { userId, isActive: true },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      select: {
        categoryId: true,
        matchField: true,
        matchType: true,
        matchValue: true,
        minAmountCents: true,
        maxAmountCents: true,
        accountId: true,
      },
    }),
    db.category.findMany({
      where: { OR: [{ userId: null }, { userId }] },
      select: { id: true, slug: true },
    }),
    db.plaidCategoryMapping.findMany({
      select: { plaidDetailed: true, categorySlug: true },
    }),
  ]);
  return {
    rules,
    categoryIdBySlug: new Map(categories.map((c) => [c.slug, c.id])),
    mappingSlugByDetailed: new Map(
      mappings.map((m) => [m.plaidDetailed, m.categorySlug]),
    ),
  };
}

function fieldValue(txn: TxnForCategorization, field: RuleMatchField): string {
  return (field === "MERCHANT_NAME" ? (txn.merchantName ?? "") : txn.name)
    .toLowerCase()
    .trim();
}

function matches(
  value: string,
  type: RuleMatchType,
  pattern: string,
): boolean {
  const p = pattern.toLowerCase().trim();
  if (p === "") return false;
  switch (type) {
    case "CONTAINS":
      return value.includes(p);
    case "EQUALS":
      return value === p;
    case "STARTS_WITH":
      return value.startsWith(p);
  }
}

export function resolveCategoryId(
  txn: TxnForCategorization,
  ctx: CategorizationContext,
): string | null {
  // 2. user rules, priority order, first match wins
  for (const rule of ctx.rules) {
    if (rule.accountId && rule.accountId !== txn.accountId) continue;
    if (rule.minAmountCents != null && txn.amountCents < rule.minAmountCents)
      continue;
    if (rule.maxAmountCents != null && txn.amountCents > rule.maxAmountCents)
      continue;
    if (matches(fieldValue(txn, rule.matchField), rule.matchType, rule.matchValue)) {
      return rule.categoryId;
    }
  }

  // 3. plaid mapping: detailed, then primary-level fallback row
  const slug =
    (txn.pfcDetailed
      ? ctx.mappingSlugByDetailed.get(txn.pfcDetailed)
      : undefined) ??
    (txn.pfcPrimary
      ? ctx.mappingSlugByDetailed.get(txn.pfcPrimary)
      : undefined);
  if (slug) {
    const id = ctx.categoryIdBySlug.get(slug);
    if (id) return id;
    log().warn({ slug }, "categorization: mapping references unknown slug");
  }

  // 4. fallback
  return ctx.categoryIdBySlug.get("uncategorized") ?? null;
}

/**
 * Recompute categories for every non-overridden transaction of a user —
 * used by rule changes and mapping updates (retroactive by design, since raw
 * Plaid categories are stored per transaction). Returns count changed.
 */
export async function recategorizeUser(userId: string): Promise<number> {
  const ctx = await loadCategorizationContext(userId);
  const txns = await db.transaction.findMany({
    where: { userId, userCategoryOverride: false, deletedAt: null },
    select: {
      id: true,
      merchantName: true,
      name: true,
      amountCents: true,
      accountId: true,
      plaidPfcPrimary: true,
      plaidPfcDetailed: true,
      categoryId: true,
    },
  });
  let changed = 0;
  for (const t of txns) {
    const next = resolveCategoryId(
      {
        merchantName: t.merchantName,
        name: t.name,
        amountCents: t.amountCents,
        accountId: t.accountId,
        pfcPrimary: t.plaidPfcPrimary,
        pfcDetailed: t.plaidPfcDetailed,
      },
      ctx,
    );
    if (next !== t.categoryId) {
      await db.transaction.update({
        where: { id: t.id },
        data: { categoryId: next },
      });
      changed += 1;
    }
  }
  log().info({ userId, total: txns.length, changed }, "recategorization run");
  return changed;
}
