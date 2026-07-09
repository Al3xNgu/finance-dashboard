import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { apiHandler, parseBody } from "@/server/lib/api-handler";
import { exchangePublicToken } from "@/server/services/items";
import { exchangePublicTokenSchema } from "@/shared/schemas/plaid";

export const POST = apiHandler(async (req: NextRequest) => {
  const { id: userId } = await requireUser();
  const { publicToken } = await parseBody(req, exchangePublicTokenSchema);
  const data = await exchangePublicToken(userId, publicToken);
  return NextResponse.json({ data }, { status: 201 });
});
