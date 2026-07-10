import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { apiHandler, parseQuery } from "@/server/lib/api-handler";
import { listSyncLogs } from "@/server/services/items";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const GET = apiHandler(async (req: NextRequest, ctx) => {
  const { id: userId } = await requireUser();
  const params = await ctx.params;
  const itemId = typeof params.id === "string" ? params.id : "";
  const { limit } = parseQuery(req, querySchema);
  return NextResponse.json({ data: await listSyncLogs(userId, itemId, limit) });
});
