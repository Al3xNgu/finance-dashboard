import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { apiHandler, parseBody } from "@/server/lib/api-handler";
import { createCategory, listCategories } from "@/server/services/categories";
import { createCategorySchema } from "@/shared/schemas/categories";

export const GET = apiHandler(async () => {
  const { id: userId } = await requireUser();
  return NextResponse.json({ data: await listCategories(userId) });
});

export const POST = apiHandler(async (req: NextRequest) => {
  const { id: userId } = await requireUser();
  const input = await parseBody(req, createCategorySchema);
  const data = await createCategory(userId, input);
  return NextResponse.json({ data }, { status: 201 });
});
