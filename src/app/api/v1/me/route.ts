import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { apiHandler } from "@/server/lib/api-handler";
import { db } from "@/server/db/client";

export const GET = apiHandler(async () => {
  const { id } = await requireUser();
  const user = await db.user.findUniqueOrThrow({
    where: { id },
    select: { id: true, email: true, name: true, image: true },
  });
  return NextResponse.json({ data: user });
});
