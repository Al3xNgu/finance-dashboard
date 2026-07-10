import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { apiHandler } from "@/server/lib/api-handler";
import { ValidationError } from "@/server/lib/errors";
import { createLinkTokenForUser } from "@/server/services/items";

const bodySchema = z.object({ itemId: z.string().min(1).optional() });

/** No body → connect mode; { itemId } → update mode for that item (D-018). */
export const POST = apiHandler(async (req: NextRequest) => {
  const { id: userId } = await requireUser();
  const raw = await req.text();
  let itemId: string | undefined;
  if (raw.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ValidationError("Request body must be valid JSON.");
    }
    const result = bodySchema.safeParse(parsed);
    if (!result.success) throw new ValidationError("Invalid request body.");
    itemId = result.data.itemId;
  }
  const data = await createLinkTokenForUser(userId, itemId);
  return NextResponse.json({ data });
});
