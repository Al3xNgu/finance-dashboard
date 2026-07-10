import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { apiHandler, parseOptionalBody } from "@/server/lib/api-handler";
import { createLinkTokenForUser } from "@/server/services/items";

const bodySchema = z.object({ itemId: z.string().min(1).optional() });

/** No body → connect mode; { itemId } → update mode for that item (D-018). */
export const POST = apiHandler(async (req: NextRequest) => {
  const { id: userId } = await requireUser();
  const { itemId } = await parseOptionalBody(req, bodySchema);
  const data = await createLinkTokenForUser(userId, itemId);
  return NextResponse.json({ data });
});
