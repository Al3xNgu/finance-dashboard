import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { encryptSecret } from "@/server/lib/crypto";
import { recategorizeUser } from "@/server/services/categorization";
import { FakePlaidService } from "@/server/services/plaid/fake";
import type {
  PlaidTransactionData,
  SyncPage,
} from "@/server/services/plaid/types";
import { syncItem } from "@/server/services/sync";

function makeTxn(
  id: string,
  over: Partial<PlaidTransactionData> = {},
): PlaidTransactionData {
  return {
    plaidTransactionId: id,
    plaidAccountId: "pa-1",
    pendingTransactionId: null,
    amountCents: 433n,
    isoCurrencyCode: "USD",
    date: "2026-07-01",
    authorizedDate: null,
    name: "STARBUCKS STORE 1234",
    merchantName: "Starbucks",
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
    nextCursor: "c-1",
    hasMore: false,
    ...over,
  };
}

async function seedWorld() {
  const user = await db.user.create({
    data: { email: `c-${Date.now()}-${Math.random()}@test.local` },
  });
  const item = await db.plaidItem.create({
    data: {
      userId: user.id,
      plaidItemId: `pi-${Math.random()}`,
      encryptedAccessToken: encryptSecret("tok"),
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
  const [coffee, food, unc] = await Promise.all([
    db.category.create({
      data: { name: "Coffee", slug: "coffee", isSystem: true },
    }),
    db.category.create({
      data: { name: "Food & Dining", slug: "food-and-dining", isSystem: true },
    }),
    db.category.create({
      data: { name: "Uncategorized", slug: "uncategorized", isSystem: true },
    }),
  ]);
  await db.plaidCategoryMapping.createMany({
    data: [
      { plaidDetailed: "FOOD_AND_DRINK_COFFEE", plaidPrimary: "FOOD_AND_DRINK", categorySlug: "coffee" },
      { plaidDetailed: "FOOD_AND_DRINK", plaidPrimary: "FOOD_AND_DRINK", categorySlug: "food-and-dining" },
    ],
  });
  return { user, item, account, coffee, food, unc };
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

describe("categorization through sync", () => {
  it("new transactions are categorized via the plaid mapping (detailed wins)", async () => {
    const { item, coffee, food } = await seedWorld();
    const fake = new FakePlaidService();
    fake.scriptSyncPage(
      null,
      makePage({
        added: [
          makeTxn("t-coffee"),
          makeTxn("t-lunch", {
            merchantName: "Chipotle",
            pfcDetailed: "FOOD_AND_DRINK_FAST_FOOD", // no detailed row → primary
          }),
        ],
      }),
    );
    await syncItem(item.id, "INITIAL", fake);

    const coffeeTxn = await db.transaction.findUniqueOrThrow({
      where: { plaidTransactionId: "t-coffee" },
    });
    expect(coffeeTxn.categoryId).toBe(coffee.id);
    const lunchTxn = await db.transaction.findUniqueOrThrow({
      where: { plaidTransactionId: "t-lunch" },
    });
    expect(lunchTxn.categoryId).toBe(food.id);
  });

  it("unmappable transactions land in uncategorized", async () => {
    const { item, unc } = await seedWorld();
    const fake = new FakePlaidService();
    fake.scriptSyncPage(
      null,
      makePage({
        added: [makeTxn("t-mystery", { pfcPrimary: "BRAND_NEW_PRIMARY", pfcDetailed: null })],
      }),
    );
    await syncItem(item.id, "INITIAL", fake);
    const row = await db.transaction.findUniqueOrThrow({
      where: { plaidTransactionId: "t-mystery" },
    });
    expect(row.categoryId).toBe(unc.id);
  });

  it("user rules beat the mapping during sync", async () => {
    const { user, item } = await seedWorld();
    const custom = await db.category.create({
      data: { userId: user.id, name: "My Coffee Budget", slug: "my-coffee-budget" },
    });
    await db.categoryRule.create({
      data: {
        userId: user.id,
        categoryId: custom.id,
        priority: 0,
        matchValue: "starbucks",
      },
    });
    const fake = new FakePlaidService();
    fake.scriptSyncPage(null, makePage({ added: [makeTxn("t-rule")] }));
    await syncItem(item.id, "INITIAL", fake);

    const row = await db.transaction.findUniqueOrThrow({
      where: { plaidTransactionId: "t-rule" },
    });
    expect(row.categoryId).toBe(custom.id);
  });

  it("recategorizeUser applies new rules retroactively but respects overrides", async () => {
    const { user, item, coffee } = await seedWorld();
    const fake = new FakePlaidService();
    fake.scriptSyncPage(
      null,
      makePage({ added: [makeTxn("t-a"), makeTxn("t-b", { plaidTransactionId: "t-b" })] }),
    );
    await syncItem(item.id, "INITIAL", fake);

    // user pins t-b manually
    await db.transaction.update({
      where: { plaidTransactionId: "t-b" },
      data: { categoryId: coffee.id, userCategoryOverride: true },
    });

    const custom = await db.category.create({
      data: { userId: user.id, name: "Treats", slug: "treats" },
    });
    await db.categoryRule.create({
      data: { userId: user.id, categoryId: custom.id, priority: 0, matchValue: "starbucks" },
    });

    const changed = await recategorizeUser(user.id);
    expect(changed).toBe(1); // only t-a

    const a = await db.transaction.findUniqueOrThrow({ where: { plaidTransactionId: "t-a" } });
    const b = await db.transaction.findUniqueOrThrow({ where: { plaidTransactionId: "t-b" } });
    expect(a.categoryId).toBe(custom.id);
    expect(b.categoryId).toBe(coffee.id); // override untouched
  });

  it("sync modified never clobbers an override even with mapping present", async () => {
    const { user, item } = await seedWorld();
    const custom = await db.category.create({
      data: { userId: user.id, name: "Pinned", slug: "pinned" },
    });
    const fake = new FakePlaidService();
    fake.scriptSyncPage(null, makePage({ added: [makeTxn("t-pin")] }));
    await syncItem(item.id, "INITIAL", fake);
    await db.transaction.update({
      where: { plaidTransactionId: "t-pin" },
      data: { categoryId: custom.id, userCategoryOverride: true },
    });

    fake.scriptSyncPage(
      "c-1",
      makePage({ modified: [makeTxn("t-pin", { amountCents: 999n })], nextCursor: "c-2" }),
    );
    await syncItem(item.id, "WEBHOOK", fake);

    const row = await db.transaction.findUniqueOrThrow({
      where: { plaidTransactionId: "t-pin" },
    });
    expect(row.amountCents).toBe(999n);
    expect(row.categoryId).toBe(custom.id);
    expect(row.userCategoryOverride).toBe(true);
  });
});
