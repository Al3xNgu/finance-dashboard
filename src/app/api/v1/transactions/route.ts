import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { apiHandler, parseQuery } from "@/server/lib/api-handler";
import { listTransactions } from "@/server/services/transactions";
import { listTransactionsQuerySchema } from "@/shared/schemas/transactions";

export const GET = apiHandler(async (req: NextRequest) => {
  const { id: userId } = await requireUser();
  const query = parseQuery(req, listTransactionsQuerySchema);
  return NextResponse.json({ data: await listTransactions(userId, query) });
});
