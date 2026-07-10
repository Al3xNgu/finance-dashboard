import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { encryptSecret } from "@/server/lib/crypto";

const { verifyWebhook, enqueue } = vi.hoisted(() => ({
  verifyWebhook: vi.fn<() => Promise<boolean>>(),
  enqueue: vi.fn(),
}));
vi.mock("@/server/services/plaid", () => ({
  getPlaidService: () => ({ verifyWebhook }),
}));
vi.mock("@/server/jobs", () => ({
  getQueue: () => ({ enqueue, schedule: vi.fn() }),
}));

import { POST } from "@/app/api/v1/plaid/webhook/route";

const ctx = { params: Promise.resolve({}) };

function makeWebhookReq(body: object) {
  return new NextRequest("http://test.local/api/v1/plaid/webhook", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function seedItem(plaidItemId: string) {
  const user = await db.user.create({
    data: { email: `w-${Date.now()}-${Math.random()}@test.local` },
  });
  return db.plaidItem.create({
    data: {
      userId: user.id,
      plaidItemId,
      encryptedAccessToken: encryptSecret("tok"),
      institutionId: "ins_1",
      institutionName: "Test Bank",
    },
  });
}

beforeEach(async () => {
  verifyWebhook.mockReset().mockResolvedValue(true);
  enqueue.mockReset();
  await db.transaction.deleteMany();
  await db.syncLog.deleteMany();
  await db.webhookEvent.deleteMany();
  await db.account.deleteMany();
  await db.plaidItem.deleteMany();
  await db.user.deleteMany();
});

describe("POST /api/v1/plaid/webhook", () => {
  it("rejects an invalid signature with 401 and does nothing", async () => {
    verifyWebhook.mockResolvedValue(false);
    const res = await POST(
      makeWebhookReq({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE" }),
      ctx,
    );
    expect(res.status).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
    expect(await db.webhookEvent.count()).toBe(0);
  });

  it("SYNC_UPDATES_AVAILABLE enqueues a deduped sync and records the event", async () => {
    const item = await seedItem("pi-hook-1");
    const res = await POST(
      makeWebhookReq({
        webhook_type: "TRANSACTIONS",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
        item_id: "pi-hook-1",
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(enqueue).toHaveBeenCalledWith(
      "sync-item",
      { itemId: item.id, trigger: "WEBHOOK" },
      { dedupKey: `sync-item:${item.id}` },
    );
    const event = await db.webhookEvent.findFirstOrThrow();
    expect(event.plaidItemId).toBe(item.id);
    expect(event.processedAt).not.toBeNull();
  });

  it("duplicate deliveries are acknowledged without re-processing", async () => {
    await seedItem("pi-hook-2");
    const body = {
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      item_id: "pi-hook-2",
    };
    await POST(makeWebhookReq(body), ctx);
    const res = await POST(makeWebhookReq(body), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).duplicate).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(await db.webhookEvent.count()).toBe(1);
  });

  it("ITEM_LOGIN_REQUIRED-class errors mark the item for re-auth", async () => {
    const item = await seedItem("pi-hook-3");
    const res = await POST(
      makeWebhookReq({
        webhook_type: "ITEM",
        webhook_code: "ERROR",
        item_id: "pi-hook-3",
        error: { error_code: "ITEM_LOGIN_REQUIRED" },
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    const fresh = await db.plaidItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(fresh.status).toBe("LOGIN_REQUIRED");
    expect(fresh.errorCode).toBe("ITEM_LOGIN_REQUIRED");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("USER_PERMISSION_REVOKED disconnects the item", async () => {
    const item = await seedItem("pi-hook-4");
    await POST(
      makeWebhookReq({
        webhook_type: "ITEM",
        webhook_code: "USER_PERMISSION_REVOKED",
        item_id: "pi-hook-4",
      }),
      ctx,
    );
    const fresh = await db.plaidItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(fresh.status).toBe("DISCONNECTED");
  });

  it("unknown webhook types are acknowledged with 200, never 500", async () => {
    const res = await POST(
      makeWebhookReq({ webhook_type: "SOMETHING_NEW", webhook_code: "WHO_KNOWS" }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(await db.webhookEvent.count()).toBe(1);
  });

  it("webhooks for unknown items are recorded but enqueue nothing", async () => {
    const res = await POST(
      makeWebhookReq({
        webhook_type: "TRANSACTIONS",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
        item_id: "pi-not-ours",
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(enqueue).not.toHaveBeenCalled();
    const event = await db.webhookEvent.findFirstOrThrow();
    expect(event.plaidItemId).toBeNull();
  });
});
