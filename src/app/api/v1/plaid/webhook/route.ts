import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db/client";
import { apiHandler } from "@/server/lib/api-handler";
import { AuthenticationError } from "@/server/lib/errors";
import { log } from "@/server/lib/request-context";
import { getQueue } from "@/server/jobs";
import { getPlaidService } from "@/server/services/plaid";
import { classifyPlaidError } from "@/server/services/plaid/errors";

/**
 * The only unauthenticated mutating route. Signature-verified, then it only
 * records + enqueues — no sync work in the request path (§6.5, D-013).
 * Idempotent: duplicate deliveries dedup on payload hash, and the queue
 * dedups per item; a duplicate sync run is harmless regardless.
 */
const webhookSchema = z
  .object({
    webhook_type: z.string(),
    webhook_code: z.string(),
    item_id: z.string().optional(),
    error: z.object({ error_code: z.string().nullable() }).nullish(),
  })
  .loose();

const SYNC_CODES = new Set([
  "SYNC_UPDATES_AVAILABLE",
  // legacy transactions webhooks — same reaction
  "INITIAL_UPDATE",
  "HISTORICAL_UPDATE",
  "DEFAULT_UPDATE",
  "TRANSACTIONS_REMOVED",
]);

export const POST = apiHandler(async (req: NextRequest) => {
  const rawBody = await req.text();

  const valid = await getPlaidService().verifyWebhook(rawBody, req.headers);
  if (!valid) {
    throw new AuthenticationError("Webhook signature verification failed.");
  }

  const parsed = webhookSchema.safeParse(JSON.parse(rawBody));
  if (!parsed.success) {
    // verified but unparseable — acknowledge so Plaid doesn't retry forever
    log().warn("webhook: verified but unrecognized payload shape");
    return NextResponse.json({ received: true });
  }
  const { webhook_type, webhook_code, item_id } = parsed.data;

  const payloadHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  const duplicate = await db.webhookEvent.findFirst({
    where: { payloadHash, processedAt: { not: null } },
    select: { id: true },
  });
  if (duplicate) {
    log().info({ webhook_type, webhook_code }, "webhook: duplicate ignored");
    return NextResponse.json({ received: true, duplicate: true });
  }

  const item = item_id
    ? await db.plaidItem.findUnique({
        where: { plaidItemId: item_id },
        select: { id: true },
      })
    : null;

  const event = await db.webhookEvent.create({
    data: {
      plaidItemId: item?.id ?? null,
      webhookType: webhook_type,
      webhookCode: webhook_code,
      payloadHash,
    },
    select: { id: true },
  });

  if (item && webhook_type === "TRANSACTIONS" && SYNC_CODES.has(webhook_code)) {
    await getQueue().enqueue(
      "sync-item",
      { itemId: item.id, trigger: "WEBHOOK" },
      { dedupKey: `sync-item:${item.id}` },
    );
  } else if (item && webhook_type === "ITEM") {
    if (webhook_code === "ERROR" || webhook_code === "LOGIN_REPAIRED") {
      const errorCode = parsed.data.error?.error_code ?? null;
      if (webhook_code === "LOGIN_REPAIRED") {
        await db.plaidItem.update({
          where: { id: item.id },
          data: { status: "ACTIVE", errorCode: null },
        });
      } else if (errorCode) {
        const cls = classifyPlaidError(errorCode);
        await db.plaidItem.update({
          where: { id: item.id },
          data: {
            status:
              cls === "REAUTH"
                ? "LOGIN_REQUIRED"
                : cls === "FATAL"
                  ? "DISCONNECTED"
                  : "ERROR",
            errorCode,
          },
        });
      }
    } else if (webhook_code === "PENDING_EXPIRATION" || webhook_code === "PENDING_DISCONNECT") {
      await db.plaidItem.update({
        where: { id: item.id },
        data: { status: "LOGIN_REQUIRED" },
      });
    } else if (webhook_code === "USER_PERMISSION_REVOKED") {
      await db.plaidItem.update({
        where: { id: item.id },
        data: { status: "DISCONNECTED", errorCode: "USER_PERMISSION_REVOKED" },
      });
    } else {
      log().info({ webhook_code }, "webhook: unhandled ITEM code acknowledged");
    }
  } else {
    log().info(
      { webhook_type, webhook_code, knownItem: !!item },
      "webhook: acknowledged without action",
    );
  }

  await db.webhookEvent.update({
    where: { id: event.id },
    data: { processedAt: new Date() },
  });
  return NextResponse.json({ received: true });
});
