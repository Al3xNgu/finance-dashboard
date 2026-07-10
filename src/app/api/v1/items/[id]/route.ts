import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { apiHandler } from "@/server/lib/api-handler";
import { disconnectItem } from "@/server/services/items";

/** Disconnect: revoke at Plaid, retain history read-only (D-019). */
export const DELETE = apiHandler(async (_req: NextRequest, ctx) => {
  const { id: userId } = await requireUser();
  const params = await ctx.params;
  const itemId = typeof params.id === "string" ? params.id : "";
  await disconnectItem(userId, itemId);
  return NextResponse.json({ data: { status: "DISCONNECTED" } });
});
