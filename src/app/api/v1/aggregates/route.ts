import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { apiHandler, parseQuery } from "@/server/lib/api-handler";
import { aggregateTransactions } from "@/server/services/aggregates";
import { aggregateQuerySchema } from "@/shared/schemas/aggregates";

export const GET = apiHandler(async (req: NextRequest) => {
  const { id: userId } = await requireUser();
  const query = parseQuery(req, aggregateQuerySchema);
  const result = await aggregateTransactions(userId, query);
  return NextResponse.json({ data: result.rows, meta: result.meta });
});
