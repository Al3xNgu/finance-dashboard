import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { encryptSecret } from "@/server/lib/crypto";
import { FakePlaidService } from "@/server/services/plaid/fake";
import { PlaidApiError } from "@/server/services/plaid/errors";
import type {
  PlaidTransactionData,
  SyncPage,
} from "@/server/services/plaid/types";
import { syncItem } from "@/server/services/sync";

const ACCESS_TOKEN = "access-fake-token";

function makeTxn(
  id: string,
  over: Partial<PlaidTransactionData> = {},
): PlaidTransactionData {
  return {
    plaidTransactionId: id,
    plaidAccountId: "pa-1",
    pendingTransactionId: null,
    amountCents: 1250n,
    isoCurrencyCode: "USD",
    date: "2026-07-01",
    authorizedDate: null,
    name: "COFFEE SHOP",
    merchantName: "Coffee Shop",
    pending: false,
    pfcPrimary: "FOOD_AND_DRINK",
    pfcDetailed: "FOOD_AND_DRINK_COFFEE",
    ...over,
  };
}

function makePage(over: Partial<SyncPage> = {}): SyncPage {
  return {
    added: [],
    modified: [],
    removed: [],
    accounts: [],
    nextCursor: "cursor-1",
    hasMore: false,
    ...over,
  };
}

async function seedItem() {
  const user = await db.user.create({
    data: { email: `t-${Date.now()}-${Math.random()}@test.local` },
  });
  const item = await db.plaidItem.create({
    data: {
      userId: user.id,
      plaidItemId: `pi-${Math.random()}`,
      encryptedAccessToken: encryptSecret(ACCESS_TOKEN),
      institutionId: "ins_1",
      institutionName: "Test Bank",
    },
  });
  const account = await db.account.create({
    data: {
      userId: user.id,
      plaidItemId: item.id,
      plaidAccountId: "pa-1",
      name: "Checking",
      type: "depository",
    },
  });
  return { user, item, account };
}

beforeEach(async () => {
  // FK-safe order
  await db.transaction.deleteMany();
  await db.syncLog.deleteMany();
  await db.webhookEvent.deleteMany();
  await db.account.deleteMany();
  await db.plaidItem.deleteMany();
  await db.user.deleteMany();
});

describe("syncItem — reconciliation matrix", () => {
  it("initial sync inserts transactions, persists cursor, logs SUCCESS", async () => {
    const { item } = await seedItem();
    const fake = new FakePlaidService();
    fake.scriptSyncPage(
      null,
      makePage({ added: [makeTxn("t1"), makeTxn("t2", { amountCents: 5000n })] }),
    );

    const result = await syncItem(item.id, "INITIAL", fake);

    expect(result).toMatchObject({ status: "SUCCESS", added: 2 });
    const rows = await db.transaction.findMany({ orderBy: { amountCents: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0].amountCents).toBe(1250n);
    const fresh = await db.plaidItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(fresh.syncCursor).toBe("cursor-1");
    expect(fresh.lastSyncedAt).not.toBeNull();
    const log = await db.syncLog.findFirstOrThrow();
    expect(log).toMatchObject({ status: "SUCCESS", addedCount: 2, cursorAfter: "cursor-1" });
  });

  it("pending→posted: retires the pending row and preserves a user override", async () => {
    const { item } = await seedItem();
    const fake = new FakePlaidService();
    fake.scriptSyncPage(
      null,
      makePage({ added: [makeTxn("pend-1", { pending: true })] }),
    );
    await syncItem(item.id, "INITIAL", fake);

    // user manually recategorizes the pending transaction
    await db.transaction.update({
      where: { plaidTransactionId: "pend-1" },
      data: { categoryId: "cat-custom", userCategoryOverride: true },
    });

    fake.scriptSyncPage(
      "cursor-1",
      makePage({
        added: [
          makeTxn("post-1", {
            pendingTransactionId: "pend-1",
            amountCents: 1300n, // settled amount differs from pending
          }),
        ],
        nextCursor: "cursor-2",
      }),
    );
    const result = await syncItem(item.id, "WEBHOOK", fake);
    expect(result.status).toBe("SUCCESS");

    const pending = await db.transaction.findUniqueOrThrow({
      where: { plaidTransactionId: "pend-1" },
    });
    expect(pending.deletedAt).not.toBeNull();

    const posted = await db.transaction.findUniqueOrThrow({
      where: { plaidTransactionId: "post-1" },
    });
    expect(posted.deletedAt).toBeNull();
    expect(posted.amountCents).toBe(1300n);
    expect(posted.categoryId).toBe("cat-custom"); // user's decision survived
    expect(posted.userCategoryOverride).toBe(true);
    expect(posted.pendingTransactionId).toBe("pend-1");
  });

  it("pending→posted without an override inherits nothing", async () => {
    const { item } = await seedItem();
    const fake = new FakePlaidService();
    fake.scriptSyncPage(null, makePage({ added: [makeTxn("pend-2", { pending: true })] }));
    await syncItem(item.id, "INITIAL", fake);

    fake.scriptSyncPage(
      "cursor-1",
      makePage({
        added: [makeTxn("post-2", { pendingTransactionId: "pend-2" })],
        nextCursor: "cursor-2",
      }),
    );
    await syncItem(item.id, "WEBHOOK", fake);

    const posted = await db.transaction.findUniqueOrThrow({
      where: { plaidTransactionId: "post-2" },
    });
    expect(posted.categoryId).toBeNull();
    expect(posted.userCategoryOverride).toBe(false);
  });

  it("posted arriving before the pending was ever seen still works", async () => {
    const { item } = await seedItem();
    const fake = new FakePlaidService();
    fake.scriptSyncPage(
      null,
      makePage({
        added: [makeTxn("post-3", { pendingTransactionId: "never-seen" })],
      }),
    );
    const result = await syncItem(item.id, "INITIAL", fake);
    expect(result).toMatchObject({ status: "SUCCESS", added: 1 });
  });

  it("removed set soft-deletes; user data is retained", async () => {
    const { item } = await seedItem();
    const fake = new FakePlaidService();
    fake.scriptSyncPage(null, makePage({ added: [makeTxn("t-rm")] }));
    await syncItem(item.id, "INITIAL", fake);

    fake.scriptSyncPage(
      "cursor-1",
      makePage({
        removed: [{ plaidTransactionId: "t-rm" }],
        nextCursor: "cursor-2",
      }),
    );
    const result = await syncItem(item.id, "WEBHOOK", fake);
    expect(result.removed).toBe(1);
    const row = await db.transaction.findUniqueOrThrow({
      where: { plaidTransactionId: "t-rm" },
    });
    expect(row.deletedAt).not.toBeNull();
  });

  it("re-sync after cursor reset converges without duplicates", async () => {
    const { item } = await seedItem();
    const fake = new FakePlaidService();
    fake.scriptSyncPage(null, makePage({ added: [makeTxn("t-dup")] }));
    await syncItem(item.id, "INITIAL", fake);

    // simulate Plaid cursor invalidation: full re-sync from null
    await db.plaidItem.update({ where: { id: item.id }, data: { syncCursor: null } });
    fake.scriptSyncPage(null, makePage({ added: [makeTxn("t-dup")] }));
    const result = await syncItem(item.id, "MANUAL", fake);

    expect(result.status).toBe("SUCCESS");
    expect(result.modified).toBe(1); // upserted, not duplicated
    expect(await db.transaction.count()).toBe(1);
  });

  it("modified never clobbers a user category override", async () => {
    const { item } = await seedItem();
    const fake = new FakePlaidService();
    fake.scriptSyncPage(null, makePage({ added: [makeTxn("t-ovr")] }));
    await syncItem(item.id, "INITIAL", fake);
    await db.transaction.update({
      where: { plaidTransactionId: "t-ovr" },
      data: { categoryId: "cat-user", userCategoryOverride: true },
    });

    fake.scriptSyncPage(
      "cursor-1",
      makePage({
        modified: [makeTxn("t-ovr", { merchantName: "Renamed Merchant", amountCents: 999n })],
        nextCursor: "cursor-2",
      }),
    );
    await syncItem(item.id, "WEBHOOK", fake);

    const row = await db.transaction.findUniqueOrThrow({
      where: { plaidTransactionId: "t-ovr" },
    });
    expect(row.merchantName).toBe("Renamed Merchant"); // plaid data updated
    expect(row.amountCents).toBe(999n);
    expect(row.categoryId).toBe("cat-user"); // user's decision intact
    expect(row.userCategoryOverride).toBe(true);
  });

  it("multi-page: crash mid-pagination resumes from the committed cursor", async () => {
    const { item } = await seedItem();
    const fake = new FakePlaidService();
    fake.scriptSyncPage(
      null,
      makePage({ added: [makeTxn("p1-t1")], nextCursor: "cursor-p1", hasMore: true }),
    );
    fake.scriptSyncPage(
      "cursor-p1",
      new PlaidApiError("INTERNAL_SERVER_ERROR", "RETRYABLE"),
    );
    // retries consume the one-shot error, then find no scripted page ⇒ but we
    // want a hard failure: script it to fail repeatedly by re-adding after run
    // simpler: use a FATAL error which is not retried
    fake.scriptSyncPage("cursor-p1", new PlaidApiError("ITEM_NOT_FOUND", "FATAL"));

    const first = await syncItem(item.id, "INITIAL", fake);
    expect(first.status).toBe("FAILED");
    // page 1 committed atomically before the failure
    expect(await db.transaction.count()).toBe(1);
    const mid = await db.plaidItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(mid.syncCursor).toBe("cursor-p1");
    const log = await db.syncLog.findFirstOrThrow({ orderBy: { startedAt: "desc" } });
    expect(log).toMatchObject({ status: "FAILED", addedCount: 1 });

    // recovery: item was marked DISCONNECTED by the fatal error — reactivate
    // (in reality re-linking does this) and finish from the committed cursor
    await db.plaidItem.update({ where: { id: item.id }, data: { status: "ACTIVE" } });
    fake.scriptSyncPage(
      "cursor-p1",
      makePage({ added: [makeTxn("p2-t1")], nextCursor: "cursor-p2" }),
    );
    const second = await syncItem(item.id, "MANUAL", fake);
    expect(second).toMatchObject({ status: "SUCCESS", added: 1 });
    expect(await db.transaction.count()).toBe(2);
  });

  it("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION restarts from committed cursor", async () => {
    const { item } = await seedItem();
    const fake = new FakePlaidService();
    fake.scriptSyncPage(
      null,
      makePage({ added: [makeTxn("m-t1")], nextCursor: "cursor-m1", hasMore: true }),
    );
    // one-shot mutation error on the second page; the retry after restart
    // hits the fake's default empty page and completes
    fake.scriptSyncPage(
      "cursor-m1",
      new PlaidApiError("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", "RETRYABLE"),
    );

    const result = await syncItem(item.id, "INITIAL", fake);
    expect(result.status).toBe("SUCCESS");
    expect(await db.transaction.count()).toBe(1);
    // restart re-read the committed cursor rather than aborting
    const calls = fake.calls.filter((c) => c.method === "syncTransactions");
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it("REAUTH errors mark the item LOGIN_REQUIRED and later syncs skip", async () => {
    const { item } = await seedItem();
    const fake = new FakePlaidService();
    fake.scriptSyncPage(null, new PlaidApiError("ITEM_LOGIN_REQUIRED", "REAUTH"));

    const result = await syncItem(item.id, "SCHEDULED", fake);
    expect(result).toMatchObject({ status: "FAILED", errorCode: "ITEM_LOGIN_REQUIRED" });
    const fresh = await db.plaidItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(fresh.status).toBe("LOGIN_REQUIRED");

    const skipped = await syncItem(item.id, "SCHEDULED", fake);
    expect(skipped.status).toBe("SKIPPED");
  });

  it("accounts newly added at the institution are created and balances refresh", async () => {
    const { item } = await seedItem();
    const fake = new FakePlaidService();
    fake.scriptSyncPage(
      null,
      makePage({
        accounts: [
          {
            plaidAccountId: "pa-1",
            name: "Checking",
            officialName: null,
            mask: "0000",
            type: "depository",
            subtype: "checking",
            currentBalanceCents: 123456n,
            availableBalanceCents: 120000n,
            isoCurrencyCode: "USD",
          },
          {
            plaidAccountId: "pa-new",
            name: "New Savings",
            officialName: null,
            mask: "9999",
            type: "depository",
            subtype: "savings",
            currentBalanceCents: 500000n,
            availableBalanceCents: 500000n,
            isoCurrencyCode: "USD",
          },
        ],
        added: [makeTxn("t-newacct", { plaidAccountId: "pa-new" })],
      }),
    );

    const result = await syncItem(item.id, "INITIAL", fake);
    expect(result).toMatchObject({ status: "SUCCESS", added: 1 });
    const checking = await db.account.findUniqueOrThrow({
      where: { plaidAccountId: "pa-1" },
    });
    expect(checking.currentBalanceCents).toBe(123456n);
    const savings = await db.account.findUniqueOrThrow({
      where: { plaidAccountId: "pa-new" },
    });
    expect(savings.currentBalanceCents).toBe(500000n);
    const txn = await db.transaction.findUniqueOrThrow({
      where: { plaidTransactionId: "t-newacct" },
    });
    expect(txn.accountId).toBe(savings.id);
  });
});
