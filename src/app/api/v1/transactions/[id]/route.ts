import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { apiHandler, parseBody } from "@/server/lib/api-handler";
import { NotFoundError } from "@/server/lib/errors";
import {
  loadCategorizationContext,
  resolveCategoryId,
} from "@/server/services/categorization";
import { patchTransactionSchema } from "@/shared/schemas/categories";

/**
 * Manual category override — the top of the resolution order (§7).
 * { categoryId } sets the override (null = force Uncategorized);
 * { clearOverride: true } recomputes from rules + mapping.
 */
export const PATCH = apiHandler(async (req: NextRequest, ctx) => {
  const { id: userId } = await requireUser();
  const params = await ctx.params;
  const txnId = typeof params.id === "string" ? params.id : "";
  const input = await parseBody(req, patchTransactionSchema);

  const txn = await db.transaction.findFirst({
    where: { id: txnId, userId, deletedAt: null },
    select: {
      id: true,
      merchantName: true,
      name: true,
      amountCents: true,
      accountId: true,
      plaidPfcPrimary: true,
      plaidPfcDetailed: true,
    },
  });
  if (!txn) throw new NotFoundError("Transaction not found.");

  if ("clearOverride" in input) {
    const catCtx = await loadCategorizationContext(userId);
    const categoryId = resolveCategoryId(
      {
        merchantName: txn.merchantName,
        name: txn.name,
        amountCents: txn.amountCents,
        accountId: txn.accountId,
        pfcPrimary: txn.plaidPfcPrimary,
        pfcDetailed: txn.plaidPfcDetailed,
      },
      catCtx,
    );
    await db.transaction.update({
      where: { id: txn.id },
      data: { categoryId, userCategoryOverride: false },
    });
    return NextResponse.json({ data: { categoryId, userCategoryOverride: false } });
  }

  if (input.categoryId) {
    const category = await db.category.findFirst({
      where: { id: input.categoryId, OR: [{ userId: null }, { userId }] },
      select: { id: true },
    });
    if (!category) throw new NotFoundError("Category not found.");
  }
  await db.transaction.update({
    where: { id: txn.id },
    data: { categoryId: input.categoryId, userCategoryOverride: true },
  });
  return NextResponse.json({
    data: { categoryId: input.categoryId, userCategoryOverride: true },
  });
});
