import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { apiHandler } from "@/server/lib/api-handler";
import { markItemReconnected } from "@/server/services/items";

/** Client-asserted completion of update-mode Link (D-018). */
export const POST = apiHandler(async (_req: NextRequest, ctx) => {
  const { id: userId } = await requireUser();
  const params = await ctx.params;
  const itemId = typeof params.id === "string" ? params.id : "";
  await markItemReconnected(userId, itemId);
  return NextResponse.json({ data: { status: "ACTIVE", syncEnqueued: true } });
});
