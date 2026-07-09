import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { apiHandler } from "@/server/lib/api-handler";
import { listAccounts } from "@/server/services/items";

export const GET = apiHandler(async () => {
  const { id: userId } = await requireUser();
  return NextResponse.json({ data: await listAccounts(userId) });
});
