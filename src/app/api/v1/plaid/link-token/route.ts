import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { apiHandler } from "@/server/lib/api-handler";
import { createLinkTokenForUser } from "@/server/services/items";

export const POST = apiHandler(async () => {
  const { id: userId } = await requireUser();
  const data = await createLinkTokenForUser(userId);
  return NextResponse.json({ data });
});
