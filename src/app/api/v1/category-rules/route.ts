import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { apiHandler, parseBody } from "@/server/lib/api-handler";
import { createRule, listRules } from "@/server/services/categories";
import { createCategoryRuleSchema } from "@/shared/schemas/categories";

export const GET = apiHandler(async () => {
  const { id: userId } = await requireUser();
  return NextResponse.json({ data: await listRules(userId) });
});

export const POST = apiHandler(async (req: NextRequest) => {
  const { id: userId } = await requireUser();
  const input = await parseBody(req, createCategoryRuleSchema);
  const data = await createRule(userId, input);
  return NextResponse.json({ data }, { status: 201 });
});
