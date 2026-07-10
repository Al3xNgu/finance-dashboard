import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { apiHandler } from "@/server/lib/api-handler";
import { NotFoundError } from "@/server/lib/errors";
import { recategorizeUser } from "@/server/services/categorization";

/**
 * Retroactively apply rules after a change. A single rule can steal matches
 * from lower-priority rules, so the correct retroactive result is a full
 * recompute of non-overridden transactions — same path as /recategorize.
 */
export const POST = apiHandler(async (_req: NextRequest, ctx) => {
  const { id: userId } = await requireUser();
  const params = await ctx.params;
  const ruleId = typeof params.id === "string" ? params.id : "";
  const rule = await db.categoryRule.findFirst({
    where: { id: ruleId, userId },
    select: { id: true },
  });
  if (!rule) throw new NotFoundError("Rule not found.");
  const changed = await recategorizeUser(userId);
  return NextResponse.json({ data: { changed } });
});
