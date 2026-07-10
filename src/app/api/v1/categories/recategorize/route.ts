import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { apiHandler } from "@/server/lib/api-handler";
import { recategorizeUser } from "@/server/services/categorization";

/** Recompute every non-overridden transaction from current rules + mapping. */
export const POST = apiHandler(async () => {
  const { id: userId } = await requireUser();
  const changed = await recategorizeUser(userId);
  return NextResponse.json({ data: { changed } });
});
