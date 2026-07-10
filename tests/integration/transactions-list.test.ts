import { beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db/client";
import { encryptSecret } from "@/server/lib/crypto";
import { ValidationError } from "@/server/lib/errors";
import { listTransactions } from "@/server/services/transactions";
import { listTransactionsQuerySchema } from "@/shared/schemas/transactions";

/** Parsed query with schema defaults applied. */
function query(over: Record<string, unknown> = {}) {
  return listTransactionsQuerySchema.parse(over);
}

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
    },
  });
  const checking = await db.account.create({
    data: {
      userId: user.id,
      plaidItemId: item.id,
      plaidAccountId: `pa-c-${Math.random()}`,
      name: "Checking",
      mask: "1111",
      type: "depository",
    },
  });
  const credit = await db.account.create({
    data: {
      userId: user.id,
      plaidItemId: item.id,
      plaidAccountId: `pa-x-${Math.random()}`,
      name: "Credit Card",
      mask: "9999",
      type: "credit",
    },
  });
  return { user, item, checking, credit };
}

type World = Awaited<ReturnType<typeof seedWorld>>;

let seq = 0;
function makeTxn(
  w: World,
  over: Partial<Prisma.TransactionUncheckedCreateInput> = {},
) {
  seq += 1;
  return db.transaction.create({
    data: {
      userId: w.user.id,
      accountId: w.checking.id,
      plaidTransactionId: `pt-${seq}-${Math.random()}`,
      amountCents: 1000n,
      date: new Date("2026-07-01"),
      name: "GENERIC PURCHASE",
      merchantName: null,
      pending: false,
      ...over,
    },
  });
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

describe("listTransactions — scoping and shape", () => {
  it("returns only the user's non-deleted transactions with account context", async () => {
    const w = await seedWorld();
    const other = await seedWorld();
    await makeTxn(w, { name: "MINE", merchantName: "Starbucks" });
    await makeTxn(other, { name: "THEIRS" });
    await makeTxn(w, { name: "GONE", deletedAt: new Date() });

    const res = await listTransactions(w.user.id, query());
    expect(res.totalCount).toBe(1);
    expect(res.transactions).toHaveLength(1);
    const t = res.transactions[0];
    expect(t.name).toBe("MINE");
    expect(t.merchantName).toBe("Starbucks");
    expect(t.date).toBe("2026-07-01");
    expect(t.amountCents).toBe(1000);
    expect(t.accountName).toBe("Checking");
    expect(t.accountMask).toBe("1111");
    expect(t.institutionName).toBe("Test Bank");
    expect(res.nextCursor).toBeNull();
  });
});

describe("listTransactions — filters", () => {
  it("date range is inclusive on both ends", async () => {
    const w = await seedWorld();
    await makeTxn(w, { name: "before", date: new Date("2026-06-30") });
    await makeTxn(w, { name: "start", date: new Date("2026-07-01") });
    await makeTxn(w, { name: "end", date: new Date("2026-07-03") });
    await makeTxn(w, { name: "after", date: new Date("2026-07-04") });

    const res = await listTransactions(
      w.user.id,
      query({ dateFrom: "2026-07-01", dateTo: "2026-07-03" }),
    );
    expect(res.transactions.map((t) => t.name).sort()).toEqual(["end", "start"]);
  });

  it("filters by account", async () => {
    const w = await seedWorld();
    await makeTxn(w, { name: "chk" });
    await makeTxn(w, { name: "cc", accountId: w.credit.id });
    const res = await listTransactions(w.user.id, query({ accountId: w.credit.id }));
    expect(res.transactions.map((t) => t.name)).toEqual(["cc"]);
    expect(res.transactions[0].accountName).toBe("Credit Card");
  });

  it("filters by category; the uncategorized filter includes null categoryId", async () => {
    const w = await seedWorld();
    const coffee = await db.category.create({
      data: { name: "Coffee", slug: "coffee", isSystem: true },
    });
    const unc = await db.category.create({
      data: { name: "Uncategorized", slug: "uncategorized", isSystem: true },
    });
    await makeTxn(w, { name: "latte", categoryId: coffee.id });
    await makeTxn(w, { name: "mapped-unc", categoryId: unc.id });
    await makeTxn(w, { name: "orphaned", categoryId: null });

    const coffeeRes = await listTransactions(w.user.id, query({ categoryId: coffee.id }));
    expect(coffeeRes.transactions.map((t) => t.name)).toEqual(["latte"]);

    const uncRes = await listTransactions(w.user.id, query({ categoryId: unc.id }));
    expect(uncRes.transactions.map((t) => t.name).sort()).toEqual([
      "mapped-unc",
      "orphaned",
    ]);
  });

  it("merchant filter is fuzzy and case-insensitive", async () => {
    const w = await seedWorld();
    await makeTxn(w, { name: "a", merchantName: "Starbucks Coffee" });
    await makeTxn(w, { name: "b", merchantName: "McDonald's" });
    const res = await listTransactions(w.user.id, query({ merchant: "STARBUCK" }));
    expect(res.transactions.map((t) => t.name)).toEqual(["a"]);
  });

  it("search matches raw name OR merchant name", async () => {
    const w = await seedWorld();
    await makeTxn(w, { name: "POS DEBIT 4417", merchantName: "Chipotle" });
    await makeTxn(w, { name: "CHIPOTLE ONLINE", merchantName: null });
    await makeTxn(w, { name: "unrelated", merchantName: "Shell" });
    const res = await listTransactions(w.user.id, query({ search: "chipotle" }));
    expect(res.transactions.map((t) => t.name).sort()).toEqual([
      "CHIPOTLE ONLINE",
      "POS DEBIT 4417",
    ]);
  });

  it("amount range and pending filters", async () => {
    const w = await seedWorld();
    await makeTxn(w, { name: "small", amountCents: 500n });
    await makeTxn(w, { name: "mid", amountCents: 1500n });
    await makeTxn(w, { name: "big", amountCents: 99999n, pending: true });

    const range = await listTransactions(
      w.user.id,
      query({ minAmountCents: "500", maxAmountCents: "1500" }),
    );
    expect(range.transactions.map((t) => t.name).sort()).toEqual(["mid", "small"]);

    const pendingOnly = await listTransactions(w.user.id, query({ pending: "true" }));
    expect(pendingOnly.transactions.map((t) => t.name)).toEqual(["big"]);
    const postedOnly = await listTransactions(w.user.id, query({ pending: "false" }));
    expect(postedOnly.transactions.map((t) => t.name).sort()).toEqual(["mid", "small"]);
  });
});

describe("listTransactions — sorting", () => {
  it("defaults to date desc; supports amount asc", async () => {
    const w = await seedWorld();
    await makeTxn(w, { name: "old-cheap", date: new Date("2026-06-01"), amountCents: 100n });
    await makeTxn(w, { name: "new-pricey", date: new Date("2026-07-05"), amountCents: 9000n });
    await makeTxn(w, { name: "mid", date: new Date("2026-06-15"), amountCents: 4000n });

    const byDate = await listTransactions(w.user.id, query());
    expect(byDate.transactions.map((t) => t.name)).toEqual([
      "new-pricey",
      "mid",
      "old-cheap",
    ]);

    const byAmount = await listTransactions(
      w.user.id,
      query({ sort: "amount", order: "asc" }),
    );
    expect(byAmount.transactions.map((t) => t.name)).toEqual([
      "old-cheap",
      "mid",
      "new-pricey",
    ]);
  });

  it("merchant sort places null merchants last in both directions", async () => {
    const w = await seedWorld();
    await makeTxn(w, { name: "z", merchantName: "Zara" });
    await makeTxn(w, { name: "none", merchantName: null });
    await makeTxn(w, { name: "a", merchantName: "Amazon" });

    const asc = await listTransactions(w.user.id, query({ sort: "merchant", order: "asc" }));
    expect(asc.transactions.map((t) => t.name)).toEqual(["a", "z", "none"]);
    const desc = await listTransactions(w.user.id, query({ sort: "merchant", order: "desc" }));
    expect(desc.transactions.map((t) => t.name)).toEqual(["z", "a", "none"]);
  });
});

describe("listTransactions — cursor pagination (D-011)", () => {
  it("walks every row exactly once across pages, including date ties", async () => {
    const w = await seedWorld();
    // 5 rows on 2 distinct dates → guaranteed sort-key ties
    for (let i = 0; i < 5; i++) {
      await makeTxn(w, {
        name: `row-${i}`,
        date: new Date(i < 3 ? "2026-07-01" : "2026-07-02"),
      });
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await listTransactions(w.user.id, query({ limit: "2", cursor }));
      expect(res.totalCount).toBe(5);
      seen.push(...res.transactions.map((t) => t.name));
      cursor = res.nextCursor ?? undefined;
      pages += 1;
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5); // no duplicates, nothing skipped
  });

  it("paginates ties on a nullable merchant sort without loss", async () => {
    const w = await seedWorld();
    for (const m of ["Amazon", "Amazon", "Amazon", null, null]) {
      await makeTxn(w, { merchantName: m });
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const res = await listTransactions(
        w.user.id,
        query({ sort: "merchant", order: "asc", limit: "2", cursor }),
      );
      seen.push(...res.transactions.map((t) => t.id));
      cursor = res.nextCursor ?? undefined;
    } while (cursor);
    expect(new Set(seen).size).toBe(5);
  });

  it("survives the cursor row being soft-deleted between pages", async () => {
    const w = await seedWorld();
    for (let i = 0; i < 4; i++) {
      await makeTxn(w, { name: `r-${i}`, date: new Date("2026-07-01") });
    }
    const page1 = await listTransactions(w.user.id, query({ limit: "2" }));
    expect(page1.transactions).toHaveLength(2);
    // sync marks the cursor row removed while the user is browsing
    await db.transaction.update({
      where: { id: page1.transactions[1].id },
      data: { deletedAt: new Date() },
    });
    const page2 = await listTransactions(
      w.user.id,
      query({ limit: "2", cursor: page1.nextCursor! }),
    );
    expect(page2.transactions).toHaveLength(2);
    const all = [...page1.transactions, ...page2.transactions].map((t) => t.id);
    expect(new Set(all).size).toBe(4);
  });

  it("rejects garbage cursors and cursors from a different sort", async () => {
    const w = await seedWorld();
    await makeTxn(w);
    await expect(
      listTransactions(w.user.id, query({ cursor: "not-a-cursor" })),
    ).rejects.toThrow(ValidationError);

    await makeTxn(w, { date: new Date("2026-07-02") });
    const page1 = await listTransactions(w.user.id, query({ limit: "1" }));
    await expect(
      listTransactions(
        w.user.id,
        query({ sort: "amount", limit: "1", cursor: page1.nextCursor! }),
      ),
    ).rejects.toThrow(ValidationError);
  });
});
