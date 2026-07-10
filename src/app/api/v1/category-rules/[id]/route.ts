import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { apiHandler, parseBody } from "@/server/lib/api-handler";
import { deleteRule, updateRule } from "@/server/services/categories";
import { updateCategoryRuleSchema } from "@/shared/schemas/categories";

function paramId(params: Record<string, string | string[]>): string {
  return typeof params.id === "string" ? params.id : "";
}

export const PATCH = apiHandler(async (req: NextRequest, ctx) => {
  const { id: userId } = await requireUser();
  const input = await parseBody(req, updateCategoryRuleSchema);
  await updateRule(userId, paramId(await ctx.params), input);
  return NextResponse.json({ data: { updated: true } });
});

export const DELETE = apiHandler(async (_req: NextRequest, ctx) => {
  const { id: userId } = await requireUser();
  await deleteRule(userId, paramId(await ctx.params));
  return NextResponse.json({ data: { deleted: true } });
});
