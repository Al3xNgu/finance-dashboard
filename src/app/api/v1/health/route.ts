import { NextResponse } from "next/server";
import { pingDatabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const dbUp = await pingDatabase();
  return NextResponse.json(
    { status: dbUp ? "ok" : "degraded", db: dbUp ? "up" : "down" },
    { status: dbUp ? 200 : 503 },
  );
}
