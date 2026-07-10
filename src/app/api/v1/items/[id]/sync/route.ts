import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { apiHandler } from "@/server/lib/api-handler";
import { NotFoundError } from "@/server/lib/errors";
import { db } from "@/server/db/client";
import { getQueue } from "@/server/jobs";

export const POST = apiHandler(async (_req: NextRequest, ctx) => {
  const { id: userId } = await requireUser();
  const params = await ctx.params;
  const itemId = typeof params.id === "string" ? params.id : "";

  // ownership check: 404 (not 403) so ids are no existence oracle
  const item = await db.plaidItem.findFirst({
    where: { id: itemId, userId },
    select: { id: true },
  });
  if (!item) throw new NotFoundError();

  await getQueue().enqueue(
    "sync-item",
    { itemId: item.id, trigger: "MANUAL" },
    { dedupKey: `sync-item:${item.id}` },
  );
  return NextResponse.json({ data: { enqueued: true } }, { status: 202 });
});
