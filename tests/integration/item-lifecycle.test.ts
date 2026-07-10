import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { encryptSecret } from "@/server/lib/crypto";
import { ConflictError, NotFoundError } from "@/server/lib/errors";
import {
  createLinkTokenForUser,
  markItemReconnected,
  disconnectItem,
  listSyncLogs,
} from "@/server/services/items";
import { FakePlaidService } from "@/server/services/plaid/fake";
import { PlaidApiError } from "@/server/services/plaid/errors";
import type { PlaidService } from "@/server/services/plaid";

async function seedWorld() {
  const user = await db.user.create({
    data: { email: `t-${Date.now()}-${Math.random()}@test.local` },
  });
  const item = await db.plaidItem.create({
    data: {
      userId: user.id,
      plaidItemId: `pi-${Math.random()}`,
      encryptedAccessToken: encryptSecret("tok"),
      institutionId: "ins_1",
      institutionName: "Test Bank",
      status: "ACTIVE",
    },
  });
  return { user, item };
}

beforeEach(async () => {
  await db.transaction.deleteMany();
  await db.categoryRule.deleteMany();
  await db.plaidCategoryMapping.deleteMany();
  await db.category.deleteMany();
  await db.syncLog.deleteMany();
  await db.webhookEvent.deleteMany();
  await db.account.deleteMany();
  await db.plaidItem.deleteMany();
  await db.user.deleteMany();
});

describe("createLinkTokenForUser — connect mode (no itemId)", () => {
  it("succeeds without accessToken in the fake call", async () => {
    const w = await seedWorld();
    const fake = new FakePlaidService();

    const res = await createLinkTokenForUser(w.user.id, undefined, fake);
    expect(res.linkToken).toMatch(/^link-fake-/);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].method).toBe("createLinkToken");
    const args = fake.calls[0].args as { userId: string; accessToken?: string };
    expect(args.userId).toBe(w.user.id);
    expect(args.accessToken).toBeUndefined();
  });
});

describe("createLinkTokenForUser — update mode (with itemId)", () => {
  it("succeeds and passes decrypted accessToken to fake", async () => {
    const w = await seedWorld();
    const fake = new FakePlaidService();

    const res = await createLinkTokenForUser(w.user.id, w.item.id, fake);
    expect(res.linkToken).toMatch(/^link-fake-/);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].method).toBe("createLinkToken");
    const args = fake.calls[0].args as { userId: string; accessToken?: string };
    expect(args.userId).toBe(w.user.id);
    expect(args.accessToken).toBe("tok");
  });

  it("rejects with NotFoundError when itemId belongs to another user", async () => {
    const w = await seedWorld();
    const other = await seedWorld();
    const fake = new FakePlaidService();

    await expect(createLinkTokenForUser(w.user.id, other.item.id, fake)).rejects.toThrow(
      NotFoundError,
    );
  });

  it("rejects with ConflictError when item status is DISCONNECTED", async () => {
    const w = await seedWorld();
    await db.plaidItem.update({
      where: { id: w.item.id },
      data: { status: "DISCONNECTED" },
    });
    const fake = new FakePlaidService();

    await expect(createLinkTokenForUser(w.user.id, w.item.id, fake)).rejects.toThrow(
      ConflictError,
    );
  });
});

describe("markItemReconnected", () => {
  it("updates item in LOGIN_REQUIRED with errorCode to ACTIVE with null errorCode", async () => {
    const w = await seedWorld();
    await db.plaidItem.update({
      where: { id: w.item.id },
      data: { status: "LOGIN_REQUIRED", errorCode: "ITEM_LOGIN_REQUIRED" },
    });

    await markItemReconnected(w.user.id, w.item.id);

    const updated = await db.plaidItem.findUnique({ where: { id: w.item.id } });
    expect(updated?.status).toBe("ACTIVE");
    expect(updated?.errorCode).toBeNull();
  });

  it("rejects with ConflictError for DISCONNECTED item and leaves status unchanged", async () => {
    const w = await seedWorld();
    await db.plaidItem.update({
      where: { id: w.item.id },
      data: { status: "DISCONNECTED" },
    });

    await expect(markItemReconnected(w.user.id, w.item.id)).rejects.toThrow(ConflictError);

    const unchanged = await db.plaidItem.findUnique({ where: { id: w.item.id } });
    expect(unchanged?.status).toBe("DISCONNECTED");
  });

  it("rejects with NotFoundError for another user's item", async () => {
    const w = await seedWorld();
    const other = await seedWorld();

    await expect(markItemReconnected(w.user.id, other.item.id)).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe("disconnectItem", () => {
  it("calls fake's removeItem and sets status to DISCONNECTED", async () => {
    const w = await seedWorld();
    const fake = new FakePlaidService();

    await disconnectItem(w.user.id, w.item.id, fake);

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].method).toBe("removeItem");
    expect(fake.calls[0].args).toBe("tok");

    const updated = await db.plaidItem.findUnique({ where: { id: w.item.id } });
    expect(updated?.status).toBe("DISCONNECTED");
  });

  it("still sets status to DISCONNECTED when removeItem throws FATAL PlaidApiError", async () => {
    const w = await seedWorld();
    // Create a minimal stub that throws FATAL for removeItem
    const fatalStub: PlaidService = {
      createLinkToken: async () => ({ linkToken: "link", expiration: new Date().toISOString() }),
      exchangePublicToken: async () => ({ accessToken: "token", plaidItemId: "pid" }),
      getAccounts: async () => ({ institutionId: "ins", accounts: [] }),
      getInstitution: async () => ({ institutionId: "ins", name: "Bank" }),
      removeItem: async () => {
        throw new PlaidApiError("ITEM_NOT_FOUND", "FATAL");
      },
      syncTransactions: async () => ({
        added: [],
        modified: [],
        removed: [],
        accounts: [],
        nextCursor: "cursor",
        hasMore: false,
      }),
      verifyWebhook: async () => true,
    };

    await disconnectItem(w.user.id, w.item.id, fatalStub);

    const updated = await db.plaidItem.findUnique({ where: { id: w.item.id } });
    expect(updated?.status).toBe("DISCONNECTED");
  });

  it("rejects when removeItem throws RETRYABLE PlaidApiError and status stays ACTIVE", async () => {
    const w = await seedWorld();
    // Create a stub that throws RETRYABLE for removeItem
    const retryableStub: PlaidService = {
      createLinkToken: async () => ({ linkToken: "link", expiration: new Date().toISOString() }),
      exchangePublicToken: async () => ({ accessToken: "token", plaidItemId: "pid" }),
      getAccounts: async () => ({ institutionId: "ins", accounts: [] }),
      getInstitution: async () => ({ institutionId: "ins", name: "Bank" }),
      removeItem: async () => {
        throw new PlaidApiError("RATE_LIMIT_EXCEEDED", "RETRYABLE");
      },
      syncTransactions: async () => ({
        added: [],
        modified: [],
        removed: [],
        accounts: [],
        nextCursor: "cursor",
        hasMore: false,
      }),
      verifyWebhook: async () => true,
    };

    await expect(disconnectItem(w.user.id, w.item.id, retryableStub)).rejects.toThrow(
      PlaidApiError,
    );

    const unchanged = await db.plaidItem.findUnique({ where: { id: w.item.id } });
    expect(unchanged?.status).toBe("ACTIVE");
  });

  it("does not call removeItem for already-DISCONNECTED item", async () => {
    const w = await seedWorld();
    await db.plaidItem.update({
      where: { id: w.item.id },
      data: { status: "DISCONNECTED" },
    });
    const fake = new FakePlaidService();

    await disconnectItem(w.user.id, w.item.id, fake);

    // No calls to fake because status is already DISCONNECTED
    expect(fake.calls).toHaveLength(0);

    const still = await db.plaidItem.findUnique({ where: { id: w.item.id } });
    expect(still?.status).toBe("DISCONNECTED");
  });

  it("rejects with NotFoundError for another user's item", async () => {
    const w = await seedWorld();
    const other = await seedWorld();
    const fake = new FakePlaidService();

    await expect(disconnectItem(w.user.id, other.item.id, fake)).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe("disconnect racing a running sync", () => {
  it("a sync finishing after a disconnect does not resurrect the item", async () => {
    const w = await seedWorld();
    // Deterministic interleaving: the "running sync" fetches its page, and the
    // disconnect commits before the sync's final status write.
    const racingStub: PlaidService = {
      createLinkToken: async () => ({ linkToken: "link", expiration: new Date().toISOString() }),
      exchangePublicToken: async () => ({ accessToken: "token", plaidItemId: "pid" }),
      getAccounts: async () => ({ institutionId: "ins", accounts: [] }),
      getInstitution: async () => ({ institutionId: "ins", name: "Bank" }),
      removeItem: async () => {},
      syncTransactions: async () => {
        await db.plaidItem.update({
          where: { id: w.item.id },
          data: { status: "DISCONNECTED" },
        });
        return { added: [], modified: [], removed: [], accounts: [], nextCursor: "c1", hasMore: false };
      },
      verifyWebhook: async () => true,
    };

    const { syncItem } = await import("@/server/services/sync");
    const result = await syncItem(w.item.id, "MANUAL", racingStub);
    expect(result.status).toBe("SUCCESS"); // the sync itself completed

    const after = await db.plaidItem.findUnique({ where: { id: w.item.id } });
    expect(after?.status).toBe("DISCONNECTED"); // terminal state wins
  });
});

describe("listSyncLogs", () => {
  it("returns logs newest-first with proper DTO fields", async () => {
    const w = await seedWorld();
    const log1 = await db.syncLog.create({
      data: {
        plaidItemId: w.item.id,
        trigger: "INITIAL",
        status: "SUCCESS",
        addedCount: 5,
        modifiedCount: 0,
        removedCount: 0,
        errorCode: null,
        startedAt: new Date("2026-07-01T10:00:00Z"),
      },
    });
    const log2 = await db.syncLog.create({
      data: {
        plaidItemId: w.item.id,
        trigger: "WEBHOOK",
        status: "RUNNING",
        addedCount: 0,
        modifiedCount: 2,
        removedCount: 0,
        errorCode: null,
        startedAt: new Date("2026-07-02T11:00:00Z"),
      },
    });

    const logs = await listSyncLogs(w.user.id, w.item.id);

    expect(logs).toHaveLength(2);
    expect(logs[0].id).toBe(log2.id);
    expect(logs[1].id).toBe(log1.id);
    expect(logs[0].trigger).toBe("WEBHOOK");
    expect(logs[0].status).toBe("RUNNING");
    expect(logs[0].addedCount).toBe(0);
    expect(logs[0].modifiedCount).toBe(2);
    expect(logs[0].removedCount).toBe(0);
    expect(logs[0].errorCode).toBeNull();
    expect(logs[0].startedAt).toMatch(/2026-07-02/);
    expect(logs[0].finishedAt).toBeNull();
  });

  it("respects the limit parameter", async () => {
    const w = await seedWorld();
    for (let i = 0; i < 5; i++) {
      await db.syncLog.create({
        data: {
          plaidItemId: w.item.id,
          trigger: "SCHEDULED",
          status: "SUCCESS",
          addedCount: i,
          modifiedCount: 0,
          removedCount: 0,
          startedAt: new Date(Date.now() - (5 - i) * 60_000),
        },
      });
    }

    const logs = await listSyncLogs(w.user.id, w.item.id, 2);

    expect(logs).toHaveLength(2);
  });

  it("rejects with NotFoundError for another user's item", async () => {
    const w = await seedWorld();
    const other = await seedWorld();

    await expect(listSyncLogs(w.user.id, other.item.id)).rejects.toThrow(NotFoundError);
  });

  it("includes errorCode and finishedAt when present", async () => {
    const w = await seedWorld();
    await db.syncLog.create({
      data: {
        plaidItemId: w.item.id,
        trigger: "MANUAL",
        status: "FAILED",
        addedCount: 0,
        modifiedCount: 0,
        removedCount: 0,
        errorCode: "RATE_LIMIT_EXCEEDED",
        finishedAt: new Date("2026-07-03T12:00:00Z"),
        startedAt: new Date("2026-07-03T11:00:00Z"),
      },
    });

    const logs = await listSyncLogs(w.user.id, w.item.id);

    expect(logs).toHaveLength(1);
    expect(logs[0].errorCode).toBe("RATE_LIMIT_EXCEEDED");
    expect(logs[0].finishedAt).toMatch(/2026-07-03T12:00:00/);
  });
});
